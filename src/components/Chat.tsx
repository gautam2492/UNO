import React, { useState, useEffect, useRef } from 'react';

interface ChatMessage {
  sender: string;
  text: string;
  timestamp: number;
}

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

export const Chat: React.FC<ChatProps> = ({ messages, onSendMessage }) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="sidebar-panel">
      <div className="chat-header">
        <h2>Game Room Chat</h2>
      </div>

      <div className="chat-messages">
        {messages.map((msg, index) => {
          const isSystem = msg.sender === 'System';
          return (
            <div
              key={index}
              className={`chat-msg ${isSystem ? 'chat-msg-system' : ''}`}
            >
              {!isSystem && <div className="chat-msg-name">{msg.sender}</div>}
              <div>{msg.text}</div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type a message..."
          maxLength={150}
          className="glass-input"
          style={{ padding: '10px 14px', fontSize: '0.9rem' }}
        />
        <button type="submit" className="btn btn-primary" style={{ padding: '10px 16px' }}>
          Send
        </button>
      </form>
    </div>
  );
};
