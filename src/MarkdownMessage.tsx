import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Terminal } from 'lucide-react';
import { useState } from 'react';

const CodeBlock = ({ node, inline, className, children, onExecuteCommand, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const codeText = String(children).replace(/\n$/, '');

  const isExecutable = match && ['bash', 'sh', 'powershell', 'cmd'].includes(match[1].toLowerCase());

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!inline && match) {
    return (
      <div style={{ position: 'relative', margin: '8px 0', borderRadius: '8px', overflow: 'hidden', border:'1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', background: '#1e1e1e', padding: '4px 12px', fontSize: '11px', color: '#888', alignItems:'center' }}>
          <span style={{fontWeight:600}}>{match[1].toUpperCase()}</span>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            {isExecutable && onExecuteCommand && (
              <button onClick={() => onExecuteCommand(codeText)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '4px', padding:0, fontWeight: 'bold' }}>
                <Terminal size={12} /> Run
              </button>
            )}
            <button onClick={handleCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#22c55e' : '#888', display: 'flex', alignItems: 'center', gap: '4px', padding:0 }}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" customStyle={{ margin: 0, padding: '12px', borderRadius: '0 0 8px 8px', fontSize: '13px', background: '#0d0d0d' }} {...props}>
          {codeText}
        </SyntaxHighlighter>
      </div>
    );
  }
  return <code className={className} style={{background: 'rgba(255,255,255,0.15)', padding:'2px 5px', borderRadius:'4px', color:'#ff79c6', fontSize:'0.9em'}} {...props}>{children}</code>;
};

export const MarkdownMessage = ({ content, onExecuteCommand }: { content: string, onExecuteCommand?: (cmd: string) => void }) => {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: (props) => <CodeBlock {...props} onExecuteCommand={onExecuteCommand} /> }}>{content}</ReactMarkdown>;
};