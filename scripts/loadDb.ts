import {DataAPIClient} from '@datastax/astra-db-ts';
import { PlaywrightWebBaseLoader } from "@langchain/community/document_loaders/web/playwright";
import { HfInference } from "@huggingface/inference";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import "dotenv/config";

type SimilarityMetric = "dot_product" | "cosine" | "euclidean";

const {ASTRA_DB_NAMESPACE, ASTRA_DB_COLLECTION, ASTRA_DB_ENDPOINT, ASTRA_DB_APPLICATION_TOKEN, HF_TOKEN} = process.env;

const hf = new HfInference(process.env.HF_TOKEN);
// small helper utilities
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const getErrMsg = (e: unknown) => {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
};

async function retryOp<T>(op: () => Promise<T>, attempts = 3, initialDelay = 1000): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await op();
    } catch (err: unknown) -{
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
const epldate = [
    'https://en.wikipedia.org/wiki/Ethiopian_Premier_League',
    'https://www.transfermarkt.com/ethiopian-premier-league/startseite/wettbewerb/ETP1',
    'https://soccerleagues.fandom.com/wiki/Ethiopian_Premier_League',
    'https://en.wikipedia.org/wiki/Ethiopian_Premier_League#Top_goalscorer_by_season',
    'https://en.wikipedia.org/wiki/Ethiopian_Premier_League#All-Time_Single_Season_Top_Goal_Scorers',
]


const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN as string);
const db = client.db(ASTRA_DB_ENDPOINT as string, { namespace: ASTRA_DB_NAMESPACE });

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize:512,
    chunkOverlap:100
})

// Debug / safety limits so seeding doesn't run forever during development.
const MAX_PAGES = Number(process.env.SEED_MAX_PAGES ?? 2); // set to `0` for no limit
const MAX_CHUNKS_PER_PAGE = Number(process.env.SEED_MAX_CHUNKS_PER_PAGE ?? 20); // set to 0 for no limit

const createCollection = async(similarityMetric: SimilarityMetric= "dot_product") =>{
  // Some Astra operations can take longer than the default 30s.
  // We'll set a higher maxTimeMS for the createCollection command and retry on transient timeouts.
  const maxAttempts = 3;
  const perRequestTimeout = 120000; // 120s
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await db.createCollection(ASTRA_DB_COLLECTION, {
        vector: {
          dimension: 1536,
          metric: similarityMetric
        },
        maxTimeMS: perRequestTimeout,
      })
      console.log(res);
      return res;
    } catch (err: unknown) {
      // detect timeout-like errors conservatively
      let msg: string;
      if (err && typeof err === 'object' && 'message' in err && typeof (err as {message: unknown}).message === 'string') {
        msg = (err as {message: string}).message;
      } else {
        msg = String(err);
      }
      const isTimeout = msg.toLowerCase().includes('timed out') || msg.toLowerCase().includes('timeout');
      console.warn(`createCollection attempt ${attempt} failed: ${msg}`);
      if (isTimeout && attempt < maxAttempts) {
        const backoff = attempt * 2000;
        console.log(`Retrying createCollection in ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
}

const loadSampleData = async() =>{
  const collection = await db.collection(ASTRA_DB_COLLECTION)
  let pagesProcessed = 0;
  let totalInserted = 0;
  for await ( const url of epldate ){
    if (MAX_PAGES && pagesProcessed >= MAX_PAGES) break;
    console.log(`Processing page: ${url}`);
    const content = await scrapePage(url);
    const chunks = await splitter.splitText(content)
    let chunksProcessed = 0;
    for await (const chunk of chunks) {
      if (MAX_CHUNKS_PER_PAGE && chunksProcessed >= MAX_CHUNKS_PER_PAGE) break;
        const response = await retryOp(() => hf.featureExtraction({
          model: "sentence-transformers/all-MiniLM-L6-v2",
          inputs: chunk,
        }), 3, 2000);

    // ✅ Ensure it's a flat 1D array of floats
    const vector = Array.isArray(response[0]) ? response[0] : response;

    const MAX_DIM = 1000;
    const safeVector = vector.length >= MAX_DIM
      ? vector.slice(0, MAX_DIM)
      : vector.concat(new Array(MAX_DIM - vector.length).fill(0));
            await retryOp(() => collection.insertOne({
              content: chunk,
              vector: safeVector,
            }), 3, 1000);
            chunksProcessed++;
            totalInserted++;
            if (totalInserted % 10 === 0) console.log(`Inserted ${totalInserted} documents so far`);
}

        pagesProcessed++;
    }
    console.log(`Seeding complete. Pages processed: ${pagesProcessed}, documents inserted: ${totalInserted}`);

}
const scrapePage =async (url: string) => {
  const loader = new PlaywrightWebBaseLoader(url, {
    launchOptions: {
      headless: true, // doesn't open a browser window
    },
    gotoOptions: {
      waitUntil: "domcontentloaded", // wait until DOM loads
    },
    evaluate: async (page, browser) => {
      const result = await page.evaluate(() => document.body.innerText); // text only
      await browser.close();
      return result;
    },
  });

  return(await loader.scrape())?.replace(/<[^>]*>?/gm, '|')
}

(async () => {
  try {
    await createCollection();
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'CollectionAlreadyExistsError') {
      console.log('Collection already exists, continuing to load data...');
    } else {
      throw err;
    }
  }
  await loadSampleData();
})();

