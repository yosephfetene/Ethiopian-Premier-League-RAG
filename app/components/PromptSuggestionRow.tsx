// components/PromptSuggestionRow.tsx
import React from "react";
import PromptSuggestionButton from "./PromptSuggestionButton";

interface PromptSuggestionRowProps {
  prompts: string[];
  onPromptClick: (text: string) => void;
}

const PromptSuggestionRow: React.FC<PromptSuggestionRowProps> = ({ 
  prompts = [], 
  onPromptClick 
}) => {
  return (
    <div className="prompt-suggestion-row" role="list" aria-label="Prompt suggestions">
      {prompts.map((p) => (
        <PromptSuggestionButton key={p} text={p} onClick={onPromptClick} />
      ))}
    </div>
  );
};

export default PromptSuggestionRow;