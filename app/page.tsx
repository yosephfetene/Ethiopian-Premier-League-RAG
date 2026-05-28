// app/page.tsx
"use client";

import Image from "next/image";
import epl from "./assets/epl.jpg";
import { useState } from "react";
import Bubble from "./components/Bubble";
import PromptSuggestionRow from "./components/PromptSuggestionRow";
import LoadingBubble from "./components/LoadingBubble";

type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
};

type ChatApiResponse = {
  answer?: string;
};

const REQUEST_TIMEOUT_MS = 45000;

const starterPrompts = [
  "Who won the last Ethiopian Premier League season?",
  "Top goal scorers this season?",
  "Recent match results for Saint George FC",
  "Famous teams in Ethiopian Premier League",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const noMessages = messages.length === 0;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setInput(e.target.value);

  const append = (msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      content: input.trim(),
      role: "user",
    };
    append(userMsg);
    setInput("");
    setIsLoading(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
        signal: controller.signal,
      });

      const data = (await res.json().catch(() => ({}))) as ChatApiResponse;
      const answer =
        data.answer?.trim() ||
        (res.ok
          ? "I could not generate a response. Please try again."
          : `Request failed with status ${res.status}. Please try again.`);

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        content: answer,
        role: "assistant",
      };
      append(assistantMsg);
    } catch (err) {
      console.error("Chat error details:", err);
      const errorMessage =
        err instanceof DOMException && err.name === "AbortError"
          ? "The request timed out. Please try again."
          : err instanceof Error
            ? err.message
            : "Unknown error occurred";
      
      append({
        id: crypto.randomUUID(),
        content: `Sorry, I encountered an error: ${errorMessage}`,
        role: "assistant",
      });
    } finally {
      window.clearTimeout(timeout);
      setIsLoading(false);
    }
  };

  const handlePrompt = (promptText: string) => {
    setInput(promptText);
  };

  return (
    <main>
      <Image src={epl} width={250} height={250} alt="EPL Logo" />
      <section className={noMessages ? "" : "populated"}>
        {noMessages ? (
          <>
            <p className="starter-text">
              The latest news place where you can ask about any Ethiopian
              Premier League questions — up to date and ready to answer.
            </p>
            <br />
            <PromptSuggestionRow
              prompts={starterPrompts}
              onPromptClick={handlePrompt}
            />
          </>
        ) : (
          <>
            {messages.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
            {isLoading && <LoadingBubble />}
          </>
        )}
      </section>

      <form onSubmit={handleSubmit}>
        <input
          className="question-box"
          onChange={handleInputChange}
          value={input}
          placeholder="Ask me something?"
          aria-label="Ask a question"
          disabled={isLoading}
        />
        <input 
          type="submit" 
          value={isLoading ? "Sending..." : "Send"}
          disabled={isLoading || !input.trim()}
        />
      </form>
    </main>
  );
}
