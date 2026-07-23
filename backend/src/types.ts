export type KnowledgeType = 'product' | 'faq' | 'after_sale' | 'size' | 'dialogue' | 'material';

export type Intent =
  | 'product_query'
  | 'size_recommendation'
  | 'product_recommendation'
  | 'after_sale'
  | 'logistics'
  | 'complaint'
  | 'manual_transfer'
  | 'operation_task';

export type Emotion = 'neutral' | 'positive' | 'negative';

export type Product = {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  stock: number;
  features: string;
  sizeGuide: string;
  targetUsers: string;
  scene: string;
};

export type KnowledgeChunk = {
  id: string;
  type: KnowledgeType;
  title: string;
  content: string;
  tags: string[];
  source: string;
  score?: number;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentTraceStep = {
  label: string;
  detail: string;
  status: 'done' | 'pending' | 'blocked';
};

export type ToolCallLog = {
  toolName: string;
  input: unknown;
  output: unknown;
  status: 'success' | 'error';
};

export type AgentToolResult = {
  id: string;
  toolName: string;
  input: unknown;
  output: unknown;
  status: 'success' | 'error';
};
