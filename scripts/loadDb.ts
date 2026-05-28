// scripts/loadDb.ts
import { DataAPIClient } from "@datastax/astra-db-ts";
import { PlaywrightWebBaseLoader } from "@langchain/community/document_loaders/web/playwright";
import { HfInference } from "@huggingface/inference";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import "dotenv/config";

type SimilarityMetric = "dot_product" | "cosine" | "euclidean";

interface AstraDocument {
  content: string;
  $vector: number[];
}

const {
  ASTRA_DB_NAMESPACE,
  ASTRA_DB_COLLECTION,
  ASTRA_DB_ENDPOINT,
  ASTRA_DB_APPLICATION_TOKEN,
  HF_TOKEN,
} = process.env;

if (!ASTRA_DB_APPLICATION_TOKEN || !ASTRA_DB_ENDPOINT || !ASTRA_DB_COLLECTION) {
  throw new Error("Missing Astra DB environment variables.");
}

if (!HF_TOKEN) {
  throw new Error("Missing HF_TOKEN environment variable.");
}

const hf = new HfInference(HF_TOKEN);
const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN);
const db = client.db(ASTRA_DB_ENDPOINT, { namespace: ASTRA_DB_NAMESPACE });

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 512,
  chunkOverlap: 100,
});

const eplUrls = [
  "https://en.wikipedia.org/wiki/Ethiopian_Premier_League",
  "https://www.transfermarkt.com/ethiopian-premier-league/startseite/wettbewerb/ETP1",
  "https://soccerleagues.fandom.com/wiki/Ethiopian_Premier_League",
  "https://www.thereporterethiopia.com/47157/",
];

const MAX_PAGES = Number(process.env.SEED_MAX_PAGES ?? 2);
const MAX_CHUNKS_PER_PAGE = Number(process.env.SEED_MAX_CHUNKS_PER_PAGE ?? 20);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getErrMsg = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") {
    return e.message;
  }
  return String(e);
};

async function retryOp<T>(op: () => Promise<T>, attempts = 3, initialDelay = 1000): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await op();
    } catch (err: unknown) {
      const msg = getErrMsg(err);
      if (attempt >= attempts) {
        throw err;
      }
      const delay = initialDelay * attempt;
      console.warn(`Operation failed (attempt ${attempt}): ${msg}. Retrying in ${delay}ms`);
      await sleep(delay);
      attempt++;
    }
  }
}

const createCollection = async (similarityMetric: SimilarityMetric = "dot_product") => {
  const maxAttempts = 3;
  const perRequestTimeout = 120000;
  
  // Use 384 dimensions for all-MiniLM-L6-v2 model
  const VECTOR_DIMENSION = 384;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await db.createCollection(ASTRA_DB_COLLECTION, {
        vector: {
          dimension: VECTOR_DIMENSION,
          metric: similarityMetric,
        },
        checkExists: false,
        maxTimeMS: perRequestTimeout,
      });
      console.log("createCollection result:", res);
      return res;
    } catch (err: unknown) {
      const msg = getErrMsg(err);
      const isTimeout = msg.toLowerCase().includes("timed out") || msg.toLowerCase().includes("timeout");
      const isCollectionExists = msg.toLowerCase().includes("already exists");
      
      console.warn(`createCollection attempt ${attempt} failed: ${msg}`);
      
      if (isCollectionExists) {
        console.log("Collection already exists, continuing...");
        return;
      }
      
      if (isTimeout && attempt < maxAttempts) {
        const backoff = attempt * 2000;
        console.log(`Retrying createCollection in ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
};

const scrapePage = async (url: string): Promise<string> => {
  try {
    const loader = new PlaywrightWebBaseLoader(url, {
      launchOptions: { headless: true },
      gotoOptions: { waitUntil: "domcontentloaded" },
    });

    const docs = await loader.load();
    const content = docs.map(doc => doc.pageContent).join("\n");
    return content.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return "";
  }
};

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number");

const isNumberMatrix = (value: unknown): value is number[][] =>
  Array.isArray(value) && value.length > 0 && value.every(isNumberArray);

const meanPool = (matrix: number[][]): number[] => {
  const dimension = matrix[0]?.length ?? 0;
  if (dimension === 0) return [];

  const totals = new Array(dimension).fill(0);
  for (const row of matrix) {
    for (let index = 0; index < dimension; index++) {
      totals[index] += row[index] ?? 0;
    }
  }

  return totals.map((value) => value / matrix.length);
};

const extractVectorCandidate = (value: unknown): number[] | null => {
  if (isNumberArray(value)) return value;
  if (isNumberMatrix(value)) return meanPool(value);
  if (Array.isArray(value) && value.length > 0) {
    return extractVectorCandidate(value[0]);
  }
  return null;
};

const extractVectorFromResponse = (response: unknown): number[] => {
  console.log("Raw embedding response type:", typeof response);

  const directVector = extractVectorCandidate(response);
  if (directVector) return directVector;

  if (response && typeof response === "object") {
    const values = Object.values(response as Record<string, unknown>);
    for (const value of values) {
      const vector = extractVectorCandidate(value);
      if (vector) return vector;
    }
  }

  console.error("Unexpected embedding response format:", response);
  throw new Error("Failed to extract vector from embedding response");
};

const loadSampleData = async (): Promise<void> => {
  const collection = await db.collection<AstraDocument>(ASTRA_DB_COLLECTION);
  let pagesProcessed = 0;
  let totalInserted = 0;

  for (const url of eplUrls) {
    if (MAX_PAGES && pagesProcessed >= MAX_PAGES) break;
    console.log(`Processing page: ${url}`);
    
    const content = await scrapePage(url);
    if (!content) {
      console.log(`No content scraped from ${url}, skipping...`);
      continue;
    }

    const chunks = await splitter.splitText(content);
    console.log(`Split into ${chunks.length} chunks`);

    let chunksProcessed = 0;
    for (const chunk of chunks) {
      if (MAX_CHUNKS_PER_PAGE && chunksProcessed >= MAX_CHUNKS_PER_PAGE) break;
      if (chunk.length < 10) continue; // Skip very short chunks

      try {
        const response = await retryOp(
          () =>
            hf.featureExtraction({
              model: "sentence-transformers/all-MiniLM-L6-v2",
              provider: "hf-inference",
              inputs: chunk,
            }),
          3,
          2000
        );

        const vector = extractVectorFromResponse(response);
        console.log(`Generated vector of dimension: ${vector.length}`);

        // all-MiniLM-L6-v2 produces 384-dimensional vectors
        const VECTOR_DIM = 384;
        const safeVector =
          vector.length >= VECTOR_DIM
            ? vector.slice(0, VECTOR_DIM)
            : [...vector, ...new Array(VECTOR_DIM - vector.length).fill(0)];

        await retryOp(
          () =>
            collection.insertOne({
              content: chunk,
              $vector: safeVector,
            }),
          3,
          1000
        );

        chunksProcessed++;
        totalInserted++;
        if (totalInserted % 5 === 0) console.log(`Inserted ${totalInserted} documents so far`);
      } catch (error) {
        console.error(`Error processing chunk:`, error);
      }
    }

    pagesProcessed++;
    console.log(`Completed page ${pagesProcessed}/${eplUrls.length}`);
  }

  console.log(`Seeding complete. Pages processed: ${pagesProcessed}, documents inserted: ${totalInserted}`);
};

(async (): Promise<void> => {
  try {
    console.log("Starting database seeding...");
    
    // Wait a bit for database to be ready if it was resuming
    await sleep(5000);
    
    await createCollection();
    await loadSampleData();
    
    console.log("Database seeding completed successfully!");
  } catch (err: unknown) {
    console.error("Seeding failed:", err);
    process.exit(1);
  }
})();
