// app/api/chat/route.ts
import { NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";
import { DataAPIClient } from "@datastax/astra-db-ts";

interface AstraDocument {
  content: string;
  vector: number[];
  _id?: any;
}

interface ChatMessage {
  content: string;
  role: 'user' | 'assistant';
}

const {
  ASTRA_DB_NAMESPACE,
  ASTRA_DB_COLLECTION,
  ASTRA_DB_ENDPOINT,
  ASTRA_DB_APPLICATION_TOKEN,
  HF_TOKEN,
} = process.env;

// Debug: Check if environment variables are loaded
console.log('Environment variables check:', {
  hasHF_TOKEN: !!HF_TOKEN,
  hasAstraToken: !!ASTRA_DB_APPLICATION_TOKEN,
  hasAstraEndpoint: !!ASTRA_DB_ENDPOINT,
  hasAstraCollection: !!ASTRA_DB_COLLECTION
});

if (!HF_TOKEN) {
  console.error("HF_TOKEN is not set in environment variables");
}

if (!ASTRA_DB_APPLICATION_TOKEN || !ASTRA_DB_ENDPOINT || !ASTRA_DB_COLLECTION) {
  console.error("Missing Astra DB environment variables");
}

// Initialize clients with error handling
let hf: HfInference;
let db: any;

try {
  hf = new HfInference(HF_TOKEN);
  const astraClient = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN!);
  db = astraClient.db(ASTRA_DB_ENDPOINT, { namespace: ASTRA_DB_NAMESPACE });
} catch (error) {
  console.error("Failed to initialize clients:", error);
}

const extractVectorFromResponse = (response: any): number[] => {
  console.log("Extracting vector from response, type:", typeof response);
  
  try {
    // If it's already an array of numbers
    if (Array.isArray(response) && typeof response[0] === 'number') {
      return response;
    }
    
    // If it's an array of arrays
    if (Array.isArray(response) && Array.isArray(response[0])) {
      return response[0];
    }
    
    // If it's an object with data property
    if (response && typeof response === 'object' && 'data' in response) {
      const data = response.data;
      if (Array.isArray(data)) {
        if (Array.isArray(data[0])) {
          return data[0];
        }
        return data;
      }
    }
    
    // Try to find any array in the object
    if (response && typeof response === 'object') {
      for (const key in response) {
        if (Array.isArray(response[key]) && response[key].length > 0) {
          if (typeof response[key][0] === 'number') {
            return response[key];
          } else if (Array.isArray(response[key][0])) {
            return response[key][0];
          }
        }
      }
    }
    
    console.error("Could not extract vector from response:", response);
    throw new Error("Failed to extract embedding vector");
  } catch (error) {
    console.error("Error in extractVectorFromResponse:", error);
    throw error;
  }
};

export async function POST(req: Request): Promise<Response> {
  try {
    console.log("Received chat request");
    
    const body = await req.json();
    console.log("Request body messages length:", body.messages?.length);
    
    const messages: ChatMessage[] = body.messages || [];
    const latestMessage = messages.length > 0 ? messages[messages.length - 1].content : "";

    if (!latestMessage) {
      return NextResponse.json({ answer: "No message provided." }, { status: 400 });
    }

    console.log("Processing message:", latestMessage.substring(0, 50) + "...");

    // Create embedding for latest message
    console.log("Creating embedding...");
    const embeddingRes = await hf.featureExtraction({
      model: "sentence-transformers/all-MiniLM-L6-v2",
      inputs: latestMessage,
    });

    console.log("Embedding response received");
    const vector = extractVectorFromResponse(embeddingRes);
    
    if (!vector || !Array.isArray(vector) || vector.length === 0) {
      console.error("Invalid vector generated");
      return NextResponse.json({ answer: "Failed to create valid embedding." }, { status: 500 });
    }

    console.log("Vector dimension:", vector.length);

    // Query Astra DB collection for nearest neighbors
    console.log("Querying Astra DB...");
    const collection = await db.collection<AstraDocument>(ASTRA_DB_COLLECTION);
    const k = 5;
    
    const docs = await collection.find({}, {
      sort: {
        $vector: vector
      },
      limit: k,
      includeSimilarity: true
    }).toArray();

    console.log(`Found ${docs.length} relevant documents`);

    const docText = docs.map((d: AstraDocument) => d.content).join("\n---\n");
    console.log("Context length:", docText.length);
    
    const systemPrompt = `You are an expert AI assistant specializing in Ethiopian Premier League football.
Use the context below from reliable sources to answer the question accurately and helpfully.

CONTEXT:
${docText}

QUESTION: ${latestMessage}

Please provide a clear, accurate answer based on the context. If the context doesn't contain relevant information, say so politely but still try to help.`;

    console.log("Sending request to Hugging Face for text generation...");

    // Use a simpler, more reliable model
    const genResponse = await hf.textGeneration({
      model: "HuggingFaceH4/zephyr-7b-beta", // More reliable model
      inputs: systemPrompt,
      parameters: {
        max_new_tokens: 512,
        temperature: 0.3,
        do_sample: true,
        return_full_text: false,
      },
    });

    console.log("Received response from Hugging Face");

    let answer = genResponse.generated_text.trim();
    
    // Clean up the response
    if (answer.startsWith('Answer:')) {
      answer = answer.substring(7).trim();
    }

    if (!answer) {
      answer = "I apologize, but I couldn't generate a response. Please try again with a different question.";
    }

    console.log("Sending answer back to client");
    return NextResponse.json({ answer });

  } catch (err: unknown) {
    console.error("API route error:", err);
    
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Error details:", error.message);
    console.error("Error stack:", error.stack);

    // Provide user-friendly error messages
    let userMessage = "Sorry, I encountered an error while processing your request. Please try again.";
    
    if (error.message.includes("token") || error.message.includes("auth") || error.message.includes("401")) {
      userMessage = "Authentication error. Please check the Hugging Face token configuration.";
    } else if (error.message.includes("rate limit") || error.message.includes("429")) {
      userMessage = "Rate limit exceeded. Please wait a moment and try again.";
    } else if (error.message.includes("network") || error.message.includes("fetch")) {
      userMessage = "Network error. Please check your internet connection and try again.";
    }

    return NextResponse.json({ 
      answer: userMessage,
      error: error.message 
    }, { status: 500 });
  }
}