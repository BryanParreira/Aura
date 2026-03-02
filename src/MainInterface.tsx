// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Settings, X, GripHorizontal, 
  Camera, Send, Eye, EyeOff, Power, Cpu, Terminal, 
  RefreshCw, Download, CheckCircle, Square, Trash2,
  Pin, PinOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MarkdownMessage } from './MarkdownMessage';
import './index.css';

// Instructing the AI to format commands properly
const DEFAULT_SYSTEM = "You are Aura, an intelligent OS copilot. Be concise. If the user asks you to perform a system task, output the script in a `bash` or `powershell` code block.";

const Draggable = ({ children, initialPos }) => {
  const [pos, setPos] = useState(initialPos);
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea') || e.target.closest('.no-drag')) return;
    isDragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    window.electronAPI.setIgnoreMouse(false);
  };

  useEffect(() => {
    const move = (e) => { 
      if (isDragging.current) {
        setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }); 
      }
    };
    const up = () => { isDragging.current = false; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const handleMouseEnter = () => window.electronAPI.setIgnoreMouse(false);
  const handleMouseLeave = () => { 
    if (!isDragging.current) window.electronAPI.setIgnoreMouse(true); 
  };

  return (
    <div 
      style={{ left: pos.x, top: pos.y, position: 'absolute', zIndex: 9999, display:'flex', flexDirection:'column', alignItems:'center' }}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter} 
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
};

const MainInterface = () => {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('aura_history');
    return saved ? JSON.parse(saved) : [{ id: 1, text: "Welcome to Aura.", sender: 'ai' }];
  });
  
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [isPinned, setIsPinned] = useState(true);
  
  const [updateStatus, setUpdateStatus] = useState({ status: 'idle', percent: 0, error: null });

  const [config, setConfig] = useState({
    provider: localStorage.getItem('provider') || 'ollama',
    apiKey: localStorage.getItem('apiKey') || '',
    model: localStorage.getItem('model') || '',
    systemContext: localStorage.getItem('systemContext') || DEFAULT_SYSTEM
  });
  const [ollamaModels, setOllamaModels] = useState([]);
  
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const activeRequestId = useRef(null);
  const abortController = useRef(false);
  const latestMessageRef = useRef(""); // To hold the latest string for TTS

  useEffect(() => {
    localStorage.setItem('aura_history', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    const handleFocus = () => {
      if (showChat && !showSettings && inputRef.current) {
        inputRef.current.focus();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [showChat, showSettings]);

  // TTS Helper
  const speakText = (text) => {
    if (!isLive) return;
    window.speechSynthesis.cancel();
    // Strip markdown formatting for cleaner speech
    const cleanText = text.replace(/[*#_`]/g, '').replace(/\[.*?\]\(.*?\)/g, 'link');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    window.electronAPI.setIgnoreMouse(true);
    if (config.provider === 'ollama') fetchOllamaModels();
    
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);

    window.electronAPI.onUpdateMsg((msg) => {
      if (msg.status === 'available') setUpdateStatus({ status: 'available', percent: 0 });
      if (msg.status === 'downloading') setUpdateStatus({ status: 'downloading', percent: Math.round(msg.percent) });
      if (msg.status === 'ready') setUpdateStatus({ status: 'ready', percent: 100 });
      if (msg.status === 'uptodate') setUpdateStatus({ status: 'uptodate', percent: 0 });
      if (msg.status === 'error') setUpdateStatus({ status: 'error', error: msg.error });
    });

    window.electronAPI.onStreamResponse((res) => {
      if (res.requestId !== activeRequestId.current || abortController.current) return;

      if (res.error) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last.sender === 'ai') return [...prev.slice(0, -1), { ...last, text: "Error: " + res.error, isLoading: false }];
          return prev;
        });
        setIsLoading(false);
        activeRequestId.current = null;
        return;
      }

      if (res.done) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last.sender === 'ai') return [...prev.slice(0, -1), { ...last, isLoading: false }];
          return prev;
        });
        setIsLoading(false);
        activeRequestId.current = null;
        // Trigger TTS when message completes
        speakText(latestMessageRef.current);
      } else {
        handleStreamChunk(res.chunk);
      }
    });

    return () => {
      window.electronAPI.removeStreamListener();
    };
  }, [messages, config.provider, isLive]);

  const handleStreamChunk = (chunk) => {
    let token = "";
    if (config.provider === 'ollama') {
      try {
        const lines = chunk.split('\n').filter(l => l.trim() !== '');
        for (const line of lines) {
          const json = JSON.parse(line);
          if (json.message && json.message.content) token += json.message.content;
        }
      } catch (e) { console.warn("Stream parse error:", e); }
    } 
    else if (config.provider === 'openai') {
      const lines = chunk.split('\n').filter(line => line.trim() !== '');
      for (const line of lines) {
        if (line.includes('[DONE]')) return;
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
              token += data.choices[0].delta.content;
            }
          } catch (e) {}
        }
      }
    }

    if (token) {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last.sender === 'ai') {
          latestMessageRef.current = last.text + token;
          return [...prev.slice(0, -1), { ...last, text: latestMessageRef.current }];
        }
        return prev;
      });
    }
  };

  const fetchOllamaModels = async () => {
    try {
      const res = await window.electronAPI.proxyRequest({
        url: 'http://localhost:11434/api/tags', method: 'GET', headers: {}
      });
      if (res.data?.models) {
        setOllamaModels(res.data.models.map(m => m.name));
        if (!config.model && res.data.models.length > 0) setConfig(p => ({...p, model: res.data.models[0].name}));
      }
    } catch (e) {}
  };

  const saveSettings = () => {
    localStorage.setItem('provider', config.provider);
    localStorage.setItem('apiKey', config.apiKey);
    localStorage.setItem('model', config.model);
    localStorage.setItem('systemContext', config.systemContext);
    setShowSettings(false);
  };

  const checkForUpdates = () => {
    setUpdateStatus({ status: 'checking', percent: 0 });
    window.electronAPI.checkForUpdates();
  };

  const togglePin = () => {
    const newState = !isPinned;
    setIsPinned(newState);
    window.electronAPI.toggleAlwaysOnTop(newState);
  };

  const handleCapture = async () => {
    try {
      const img = await window.electronAPI.captureScreen();
      setMessages(p => [...p, { id: Date.now(), text: "Analyze this screen.", sender: 'user', isImage: true }]);
      if (!showChat) setShowChat(true);
      callAI("Describe this screen in detail.", img);
    } catch (e) {}
  };

  const handleSend = () => {
    if (!input.trim()) return;
    window.speechSynthesis.cancel(); // Stop speaking if user interrupts
    setMessages(p => [...p, { id: Date.now(), text: input, sender: 'user' }]);
    setInput("");
    callAI(input);
  };

  const handleStop = () => {
    abortController.current = true;
    setIsLoading(false);
    activeRequestId.current = null;
    window.speechSynthesis.cancel();
  };

  // Agentic Command Execution Loop
  const executeAgentCommand = async (cmd) => {
    setMessages(p => [...p, { id: Date.now(), text: `Executing...\n\`\`\`bash\n${cmd}\n\`\`\``, sender: 'user' }]);
    setIsLoading(true);
    
    const res = await window.electronAPI.runCommand(cmd);
    const feedback = `I executed your command. Here is the terminal output:\n\`\`\`\n${res.output || "Success (No Output)"}\n\`\`\`\nTell me if it worked or if we need to fix an error.`;
    
    setMessages(p => [...p, { id: Date.now()+1, text: feedback, sender: 'user' }]);
    callAI(feedback);
  };

  const callAI = async (prompt, img = null) => {
    abortController.current = false;
    latestMessageRef.current = "";
    const requestId = Date.now().toString();
    activeRequestId.current = requestId;
    setIsLoading(true);

    setMessages(p => [...p, { id: Date.now() + 2, text: "", sender: 'ai', isLoading: true }]);

    const { provider, apiKey, model, systemContext } = config;
    const imageBase64 = img ? img.split(',')[1] : null;

    const history = messages.slice(-10).map(m => ({
      role: m.sender === 'ai' ? 'assistant' : 'user',
      content: m.text
    }));

    const fullMessages = [{ role: 'system', content: systemContext || DEFAULT_SYSTEM }, ...history];

    if (provider === 'ollama') {
      const newMessage = { role: 'user', content: prompt };
      if (imageBase64) newMessage.images = [imageBase64];

      window.electronAPI.streamRequest({
        url: 'http://localhost:11434/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { model: model || 'llama3', messages: [...fullMessages, newMessage], stream: true },
        requestId
      });
    } else if (provider === 'openai') {
      const content = [{ type: "text", text: prompt }];
      if (imageBase64) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } });

      window.electronAPI.streamRequest({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: { model: model || 'gpt-4o', messages: [...fullMessages, { role: 'user', content }], stream: true },
        requestId
      });
    }
  };

  const callAIRef = useRef(callAI);
  useEffect(() => { callAIRef.current = callAI; });

  useEffect(() => {
    let recognition = null;
    if (isLive) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false; 
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          if (transcript.trim()) {
            setInput(transcript); 
            window.speechSynthesis.cancel();
            setMessages(p => [...p, { id: Date.now(), text: transcript, sender: 'user' }]);
            callAIRef.current(transcript);
          }
        };
        recognition.onend = () => { if (isLive) try { recognition.start(); } catch (e) {} };
        try { recognition.start(); } catch (e) {}
      }
    }
    return () => { if (recognition) recognition.stop(); };
  }, [isLive]);

  return (
    <div className="invisible-canvas">
      <Draggable initialPos={{ x: window.innerWidth/2 - 200, y: 50 }}>
        
        <div className={`glass-panel widget-pill ${isLoading ? 'thinking-border' : ''}`}>
          <div className="drag-handle"><GripHorizontal size={14} /></div>
          <div className="aura-orb-container"><div className={`aura-orb ${isLoading ? 'active' : ''}`} /></div>
          <div className="divider" />
          
          <button className={`icon-btn ${isLive ? 'active-live' : ''}`} onClick={() => setIsLive(!isLive)} title="Toggle Voice">
            {isLive ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          
          <button className="icon-btn" onClick={handleCapture} title="Snap Screen"><Camera size={16} /></button>
          <div className="divider" />
          
          <button className={`icon-btn ${isPinned ? 'active-white' : ''}`} onClick={togglePin} title={isPinned ? "Unpin" : "Pin to Top"}>
            {isPinned ? <Pin size={16} /> : <PinOff size={16} />}
          </button>

          <button className={`icon-btn ${showChat ? 'active-white' : ''}`} onClick={() => setShowChat(!showChat)} title="Toggle Chat">
            {showChat ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          
          <button className="icon-btn danger-hover" onClick={() => window.electronAPI.quitApp()} title="Quit Aura"><Power size={16} /></button>
        </div>

        <AnimatePresence>
          {showChat && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`glass-panel chat-window ${isLoading ? 'thinking-border' : ''}`}
            >
              
              {showSettings ? (
                <div className="settings-panel no-drag">
                  <div className="setting-header"><span>Config</span><button className="icon-btn" onClick={() => setShowSettings(false)}><X size={16}/></button></div>
                  <button className="setting-input" onClick={() => setMessages([{ id: 1, text: "Memory Cleared.", sender: 'ai' }])} style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'6px', cursor:'pointer', marginBottom:'10px', color: '#ff79c6'}}>
                    <Trash2 size={14}/> Clear Memory
                  </button>
                  <div className="setting-section"><div className="section-title"><Cpu size={12}/> Brain</div>
                    <div className="setting-row"><select className="setting-input" value={config.provider} onChange={e => setConfig({...config, provider: e.target.value})}><option value="ollama">Ollama (Local)</option><option value="openai">OpenAI</option></select></div>
                    {config.provider === 'ollama' ? 
                      <div className="setting-row"><select className="setting-input" value={config.model} onChange={e => setConfig({...config, model: e.target.value})}>{ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}</select></div> : 
                      <div className="setting-row"><input className="setting-input" type="password" value={config.apiKey} onChange={e => setConfig({...config, apiKey: e.target.value})} placeholder="API Key..." /></div>
                    }
                  </div>
                  <div className="setting-section"><div className="section-title"><Terminal size={12}/> Persona</div><textarea className="setting-input area" value={config.systemContext} onChange={e => setConfig({...config, systemContext: e.target.value})} /></div>
                  
                  <div className="setting-section" style={{marginTop: 'auto', marginBottom: '10px', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px'}}>
                    <div className="section-title" style={{marginBottom:'5px'}}><RefreshCw size={12}/> Updates</div>
                    {updateStatus.status === 'idle' && <button className="setting-input" onClick={checkForUpdates} style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'6px', cursor:'pointer'}}><RefreshCw size={14}/> Check for Updates</button>}
                    {updateStatus.status === 'checking' && <div style={{fontSize:'12px', color:'#aaa', textAlign:'center', padding:'5px'}}>Checking...</div>}
                    {updateStatus.status === 'available' && <div style={{fontSize:'12px', color:'#3b82f6', textAlign:'center', padding:'5px'}}>Downloading update...</div>}
                    {updateStatus.status === 'downloading' && (
                      <div style={{width:'100%', background:'rgba(255,255,255,0.1)', height:'6px', borderRadius:'3px', overflow:'hidden'}}>
                        <div style={{width: `${updateStatus.percent}%`, background:'#3b82f6', height:'100%'}} />
                      </div>
                    )}
                    {updateStatus.status === 'ready' && <button className="setting-input" onClick={() => window.electronAPI.quitAndInstall()} style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'6px', cursor:'pointer', background:'rgba(34, 197, 94, 0.2)', color:'#4ade80'}}><Download size={14}/> Restart & Install</button>}
                    {updateStatus.status === 'uptodate' && <div style={{fontSize:'12px', color:'#4ade80', textAlign:'center', padding:'5px'}}><CheckCircle size={14} style={{display:'inline', verticalAlign:'middle'}}/> Up to date</div>}
                  </div>
                  <button className="save-btn" onClick={saveSettings}>Save</button>
                </div>
              ) : (
                <>
                  <div className="chat-header">
                    <span className={`status-text ${isLive ? 'live' : ''}`}>{isLive ? "● LISTENING" : "● AURA READY"}</span>
                    <button className="icon-btn" onClick={() => setShowSettings(!showSettings)}><Settings size={14}/></button>
                  </div>

                  <div className="chat-body no-drag">
                    {messages.map((m) => (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={m.id} className={`msg-row ${m.sender}`}>
                        <div className="msg-bubble">
                          {m.isImage ? "📸 Screen Captured" : m.sender === 'ai' && !m.text ? (
                            <div className="thinking-bubble"><div className="dot"/><div className="dot"/><div className="dot"/></div>
                          ) : (
                            <MarkdownMessage content={m.text} onExecuteCommand={executeAgentCommand} />
                          )}
                        </div>
                      </motion.div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="input-area no-drag">
                    <div className="input-glass">
                      <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Ask Aura..." />
                      {isLoading ? (
                        <button className="icon-btn" onClick={handleStop} title="Stop Generating"><Square size={14} fill="currentColor" /></button>
                      ) : (
                        <button className="icon-btn" onClick={handleSend} title="Send"><Send size={14}/></button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Draggable>
    </div>
  );
};

export default MainInterface;