import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Goal Agent Studio',
};

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
