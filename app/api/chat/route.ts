import { NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";
import { DataAPIClient } from "@datastax/astra-db-ts";

interface AstraDocument {
  content?: string;
  $vector?: number[];
  _id?: unknown;
}

interface ChatMessage {
  content: string;
  role: "user" | "assistant";
}

interface AppConfig {
  astraDbNamespace?: string;
  astraDbCollection: string;
  astraDbEndpoint: string;
  astraDbApplicationToken: string;
  hfToken: string;
}

const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const GENERATION_MODEL =
  process.env.HF_GENERATION_MODEL ?? "HuggingFaceH4/zephyr-7b-beta";
const HF_PROVIDER = "hf-inference";
const VECTOR_DIMENSION = 384;
const EMBEDDING_TIMEOUT_MS = Number(process.env.HF_EMBEDDING_TIMEOUT_MS ?? 20000);
const GENERATION_TIMEOUT_MS = Number(process.env.HF_GENERATION_TIMEOUT_MS ?? 30000);
const ASTRA_QUERY_TIMEOUT_MS = Number(process.env.ASTRA_QUERY_TIMEOUT_MS ?? 15000);

const getConfig = (): AppConfig => {
  const missing: string[] = [];
  const {
    ASTRA_DB_NAMESPACE,
    ASTRA_DB_COLLECTION,
    ASTRA_DB_ENDPOINT,
    ASTRA_DB_APPLICATION_TOKEN,
    HF_TOKEN,
  } = process.env;

  if (!ASTRA_DB_COLLECTION) missing.push("ASTRA_DB_COLLECTION");
  if (!ASTRA_DB_ENDPOINT) missing.push("ASTRA_DB_ENDPOINT");
  if (!ASTRA_DB_APPLICATION_TOKEN) missing.push("ASTRA_DB_APPLICATION_TOKEN");
  if (!HF_TOKEN) missing.push("HF_TOKEN");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    astraDbNamespace: ASTRA_DB_NAMESPACE,
    astraDbCollection: ASTRA_DB_COLLECTION,
    astraDbEndpoint: ASTRA_DB_ENDPOINT,
    astraDbApplicationToken: ASTRA_DB_APPLICATION_TOKEN,
    hfToken: HF_TOKEN,
  };
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
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
  const directVector = extractVectorCandidate(response);
  if (directVector) return directVector;

  if (response && typeof response === "object") {
    const values = Object.values(response as Record<string, unknown>);
    for (const value of values) {
      const vector = extractVectorCandidate(value);
      if (vector) return vector;
    }
  }

  throw new Error("Unexpected embedding format from Hugging Face API.");
};

const normalizeVector = (vector: number[]): number[] =>
  vector.length >= VECTOR_DIMENSION
    ? vector.slice(0, VECTOR_DIMENSION)
    : [...vector, ...Array(VECTOR_DIMENSION - vector.length).fill(0)];

const withTimeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timeout!);
    controller.abort();
  }
};

const buildFallbackAnswer = (contextParts: string[]): string => {
  if (contextParts.length === 0) {
    return "I could not reach the Ethiopian Premier League knowledge base right now. Please check the Astra DB endpoint and try again.";
  }

  const contextPreview = contextParts.join("\n\n").slice(0, 1500);
  return `I found relevant database context, but the text generator did not respond in time. Here is the most relevant information I found:\n\n${contextPreview}`;
};

export async function POST(req: Request) {
  try {
    const config = getConfig();
    const hf = new HfInference(config.hfToken);
    const astraClient = new DataAPIClient(config.astraDbApplicationToken);
    const db = astraClient.db(config.astraDbEndpoint, {
      namespace: config.astraDbNamespace,
    });

    const body = await req.json();
    const messages: ChatMessage[] = body.messages || [];
    const latestMessage = messages.at(-1)?.content?.trim();

    if (!latestMessage) {
      return NextResponse.json({ answer: "No message provided." }, { status: 400 });
    }

    const embeddingRes = await withTimeout(
      (signal) =>
        hf.featureExtraction(
          {
            model: EMBEDDING_MODEL,
            provider: HF_PROVIDER,
            inputs: latestMessage,
          },
          { signal }
        ),
      EMBEDDING_TIMEOUT_MS,
      "Embedding request"
    );

    const vector = extractVectorFromResponse(embeddingRes);
    const safeVector = normalizeVector(vector);

    const collection = db.collection<AstraDocument>(config.astraDbCollection);
    let docs: AstraDocument[] = [];

    try {
      docs = await withTimeout(
        () =>
          collection
            .find(
              {},
              {
                sort: { $vector: safeVector },
                limit: 5,
                includeSimilarity: true,
                projection: { content: 1 },
              }
            )
            .toArray(),
        ASTRA_QUERY_TIMEOUT_MS,
        "Astra query"
      );
    } catch (error) {
      console.error("Astra query failed:", getErrorMessage(error));
    }

    const contextParts = docs
      .map((doc) => doc.content)
      .filter((content): content is string => Boolean(content?.trim()));

    const context =
      contextParts.length > 0
        ? contextParts.join("\n---\n")
        : "No relevant information found in the database.";

    const systemPrompt = `You are an expert AI assistant specializing in Ethiopian Premier League football.
Use the following CONTEXT to answer the QUESTION accurately.

CONTEXT:
${context}

QUESTION: ${latestMessage}

If the context does not help, say "I do not have specific info in my database, but generally..." and give a helpful general answer.`;

    let answer = "";

    try {
      const genResponse = await withTimeout(
        (signal) =>
          hf.textGeneration(
            {
              model: GENERATION_MODEL,
              inputs: systemPrompt,
              parameters: {
                max_new_tokens: 256,
                temperature: 0.4,
                do_sample: true,
                return_full_text: false,
              },
            },
            { signal }
          ),
        GENERATION_TIMEOUT_MS,
        "Text generation request"
      );

      answer =
        genResponse.generated_text?.trim() ||
        "I could not generate a response. Please try again.";
    } catch (error) {
      console.error("Text generation failed:", getErrorMessage(error));
      answer = buildFallbackAnswer(contextParts);
    }

    return NextResponse.json({ answer });
  } catch (error) {
    const message = getErrorMessage(error);
    const lowerMessage = message.toLowerCase();
    console.error("Chat API Error:", message);

    if (lowerMessage.includes("resuming your database")) {
      return NextResponse.json(
        { answer: "The database is resuming. Please wait and try again." },
        { status: 503 }
      );
    }

    if (lowerMessage.includes("timed out")) {
      return NextResponse.json(
        { answer: "The request timed out. Please try again in a moment." },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { answer: "An internal error occurred. Please try again later." },
      { status: 500 }
    );
  }
}
