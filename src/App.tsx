import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const DURATIONS = [1, 3, 5, 10, 15, 30, 60];

interface ClickEvent {
  time: number;
}

interface SessionResult {
  date: number;
  duration: number;
  clicks: number;
  cps: number;
}

const getRank = (cps: number, duration: number) => {
  if (cps === 0) return { name: 'SYSTEM_FAILURE', color: 'text-red-500', icon: '⚠️' };
  
  const adjustedCps = cps * (5 / Math.max(duration, 5));
  
  if (adjustedCps < 4) return { name: 'NOVICE_CLICKER', color: 'text-white/60', icon: '🌱' };
  if (adjustedCps < 6) return { name: 'APPRENTICE', color: 'text-green-400', icon: '⚡' };
  if (adjustedCps < 8) return { name: 'ADEPT_CLICKER', color: 'text-[#E0FF00]', icon: '🎯' };
  if (adjustedCps < 10) return { name: 'CYBER_NINJA', color: 'text-cyan-400', icon: '🥷' };
  if (adjustedCps < 12) return { name: 'NEURAL_LINK', color: 'text-purple-400', icon: '🧠' };
  if (adjustedCps < 15) return { name: 'MECH_OVERLOAD', color: 'text-orange-500', icon: '🤖' };
  return { name: 'GOD_TIER', color: 'text-red-500', icon: '👑' };
};

export default function App() {
  const [duration, setDuration] = useState(5);
  const [timeLeft, setTimeLeft] = useState(5);
  const [clicks, setClicks] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [bestScores, setBestScores] = useState<Record<number, number>>({});
  const [clickEffects, setClickEffects] = useState<{id: number, x: number, y: number}[]>([]);
  const [clickEvents, setClickEvents] = useState<ClickEvent[]>([]);
  const [cpsHistory, setCpsHistory] = useState<number[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    const savedScores = localStorage.getItem('cpsBestScores');
    if (savedScores) {
      try {
        setBestScores(JSON.parse(savedScores));
      } catch (e) {
        console.error('Failed to parse best scores', e);
      }
    }
    
    const savedHistory = localStorage.getItem('cpsSessionHistory');
    if (savedHistory) {
      try {
        setSessionHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse session history', e);
      }
    }
  }, []);

  const saveBestScore = useCallback((dur: number, cps: number) => {
    setBestScores(prev => {
      const currentBest = prev[dur] || 0;
      if (cps > currentBest) {
        const next = { ...prev, [dur]: cps };
        localStorage.setItem('cpsBestScores', JSON.stringify(next));
        return next;
      }
      return prev;
    });
  }, []);

  const saveSession = useCallback((dur: number, clickCount: number, cps: number) => {
    const result: SessionResult = {
      date: Date.now(),
      duration: dur,
      clicks: clickCount,
      cps
    };
    setSessionHistory(prev => {
      const next = [result, ...prev].slice(0, 50);
      localStorage.setItem('cpsSessionHistory', JSON.stringify(next));
      return next;
    });
  }, []);

  const startGame = () => {
    setClicks(1);
    setClickEvents([{ time: performance.now() }]);
    setIsActive(true);
    setIsFinished(false);
    setTimeLeft(duration);
    setCpsHistory([]);
    startTimeRef.current = performance.now();
    lastUpdateRef.current = performance.now();
    
    timerRef.current = window.setInterval(() => {
      const now = performance.now();
      const elapsed = (now - startTimeRef.current!) / 1000;
      const remaining = Math.max(0, duration - elapsed);
      setTimeLeft(remaining);
      
      if (now - lastUpdateRef.current > 200) {
        lastUpdateRef.current = now;
        setClickEvents(prev => {
          const windowStart = now - 1000;
          const recentClicks = prev.filter(e => e.time > windowStart).length;
          setCpsHistory(h => [...h.slice(-30), recentClicks]);
          return prev;
        });
      }
      
      if (remaining === 0) {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }, 16);
  };

  useEffect(() => {
    if (isActive && timeLeft === 0) {
      setIsActive(false);
      setIsFinished(true);
      if (timerRef.current) clearInterval(timerRef.current);
      
      const finalCps = clicks / duration;
      saveBestScore(duration, finalCps);
      saveSession(duration, clicks, finalCps);
    }
  }, [timeLeft, isActive, clicks, duration, saveBestScore, saveSession]);

  const registerClick = (clientX?: number, clientY?: number, rect?: DOMRect) => {
    if (isFinished) return;

    if (isActive && startTimeRef.current) {
      const elapsed = (performance.now() - startTimeRef.current) / 1000;
      if (elapsed >= duration) {
        return;
      }
    }

    let x = 0;
    let y = 0;
    if (clientX !== undefined && clientY !== undefined && rect) {
      x = clientX - rect.left;
      y = clientY - rect.top;
    } else if (rect) {
      x = rect.width / 2;
      y = rect.height / 2;
    }

    const id = Date.now() + Math.random();
    setClickEffects(prev => [...prev.slice(-20), { id, x, y }]);
    
    setTimeout(() => {
      setClickEffects(prev => prev.filter(c => c.id !== id));
    }, 400);

    const now = performance.now();
    setClickEvents(prev => [...prev, { time: now }]);

    if (startTimeRef.current && now - lastUpdateRef.current > 200) {
      lastUpdateRef.current = now;
      const windowStart = now - 1000;
      const recentClicks = clickEvents.filter(e => e.time > windowStart).length + 1;
      setCpsHistory(h => [...h.slice(-30), recentClicks]);
    }

    if (!isActive) {
      startGame();
    } else {
      setClicks(c => c + 1);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    registerClick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      registerClick(undefined, undefined, e.currentTarget.getBoundingClientRect());
    }
  };

  const reset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsActive(false);
    setIsFinished(false);
    setClicks(0);
    setTimeLeft(duration);
    setClickEffects([]);
    setClickEvents([]);
    setCpsHistory([]);
  };

  const handleDurationChange = (d: number) => {
    if (isActive) return;
    setDuration(d);
    setTimeLeft(d);
    setClicks(0);
    setIsFinished(false);
    setClickEffects([]);
    setClickEvents([]);
    setCpsHistory([]);
  };

  const clearHistory = () => {
    setSessionHistory([]);
    localStorage.removeItem('cpsSessionHistory');
  };

  const finalCps = clicks / duration;
  const rank = getRank(parseFloat(finalCps.toFixed(2)), duration);
  
  const avgHistory = sessionHistory.length > 0 
    ? sessionHistory.reduce((sum, s) => sum + s.cps, 0) / sessionHistory.length 
    : 0;

  return (
    <div className="min-h-screen bg-grid font-sans flex flex-col selection:bg-[#E0FF00] selection:text-black">
      <header className="w-full border-b border-white/10 p-4 flex justify-between items-center bg-black/50 backdrop-blur-md fixed top-0 z-50">
        <div className="font-mono font-bold tracking-widest text-xs sm:text-sm text-white">SYS.CPS_TESTER // V3.0</div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="font-mono text-[10px] sm:text-xs text-white/50 hover:text-[#E0FF00] transition-colors"
          >
            {showHistory ? '◀ HIDE' : '📊 HISTORY'}
          </button>
          <div className="font-mono text-[10px] sm:text-xs text-white/50 flex items-center gap-2">
            <span className="hidden sm:inline">BEST[{duration}s]:</span>
            <span className="text-[#E0FF00] text-sm sm:text-base font-bold">{bestScores[duration]?.toFixed(2) || '0.00'}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 pt-20 pb-8 px-4 sm:px-8 flex flex-col items-center max-w-6xl mx-auto w-full gap-6 sm:gap-8">
        <div className={`flex gap-6 w-full transition-all ${showHistory ? 'flex-col' : 'flex-col lg:flex-row'}`}>
          <div className="flex-1 flex flex-col gap-6">
            <div className="flex flex-col items-center gap-3 w-full">
              <div className="text-[10px] font-mono tracking-[0.3em] text-white/40 uppercase">Select_Duration</div>
              <div className="flex flex-wrap justify-center gap-2">
                {DURATIONS.map(d => (
                  <button
                    key={d}
                    onClick={() => handleDurationChange(d)}
                    disabled={isActive}
                    className={`px-4 sm:px-6 py-2 font-mono text-xs sm:text-sm font-bold transition-all border ${
                      duration === d 
                        ? 'bg-[#E0FF00] text-black border-[#E0FF00] shadow-[0_0_15px_rgba(224,255,0,0.3)]' 
                        : 'bg-black/50 text-white border-white/20 hover:border-white/60'
                    } ${isActive ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    {d}S
                  </button>
                ))}
              </div>
            </div>

            <div className="w-full grid grid-cols-3 border border-white/20 bg-black/60 backdrop-blur-md shadow-2xl">
              <div className="p-4 sm:p-6 border-r border-white/20 flex flex-col items-center justify-center">
                <div className="text-[9px] sm:text-[10px] font-mono tracking-[0.2em] text-white/50 mb-1 sm:mb-2 text-center">TIME_LEFT</div>
                <div className="text-4xl sm:text-7xl font-mono font-bold text-white">{timeLeft.toFixed(1)}</div>
              </div>
              <div className="p-4 sm:p-6 border-r border-white/20 flex flex-col items-center justify-center">
                <div className="text-[9px] sm:text-[10px] font-mono tracking-[0.2em] text-white/50 mb-1 sm:mb-2 text-center">CLICKS</div>
                <div className="text-4xl sm:text-7xl font-mono font-bold text-white">{clicks}</div>
              </div>
              <div className="p-4 sm:p-6 flex flex-col items-center justify-center">
                <div className="text-[9px] sm:text-[10px] font-mono tracking-[0.2em] text-white/50 mb-1 sm:mb-2 text-center">CURRENT_CPS</div>
                <div className="text-4xl sm:text-7xl font-mono font-bold text-[#E0FF00]">
                  {isActive ? (clicks / Math.max(0.1, duration - timeLeft)).toFixed(1) : (clicks === 0 ? '0.0' : finalCps.toFixed(1))}
                </div>
              </div>
            </div>

            {isActive && cpsHistory.length > 1 && (
              <div className="w-full h-24 border border-white/20 bg-black/60 backdrop-blur-md p-3">
                <div className="text-[9px] font-mono tracking-[0.2em] text-white/50 mb-2">REAL_TIME_CPS</div>
                <div className="flex items-end gap-[2px] h-12">
                  {cpsHistory.map((cps, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-[#E0FF00] transition-all duration-75"
                      style={{ 
                        height: `${Math.min(100, (cps / 20) * 100)}%`,
                        opacity: i === cpsHistory.length - 1 ? 1 : 0.5
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="w-full flex-1 min-h-[300px] sm:min-h-[350px] relative">
              <AnimatePresence mode="wait">
                {!isFinished ? (
                  <motion.button
                    key="clicker"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    whileTap={{ scale: 0.98 }}
                    onPointerDown={handlePointerDown}
                    onKeyDown={handleKeyDown}
                    tabIndex={0}
                    className={`w-full h-full border-2 relative overflow-hidden flex items-center justify-center group touch-none select-none transition-colors duration-200 cursor-pointer
                      ${isActive ? 'border-[#E0FF00] bg-[#E0FF00]/5' : 'border-white/20 bg-black/40 hover:border-white/40 hover:bg-white/5'}`}
                  >
                    {clickEffects.map(effect => (
                      <motion.div
                        key={effect.id}
                        initial={{ scale: 0.5, opacity: 1 }}
                        animate={{ scale: 2.5, opacity: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        className="absolute w-16 h-16 border-2 border-[#E0FF00] pointer-events-none rounded-full"
                        style={{ left: effect.x - 32, top: effect.y - 32 }}
                      />
                    ))}
                    
                    <div className="flex flex-col items-center gap-2 sm:gap-4 z-10 pointer-events-none">
                      <span className={`text-6xl sm:text-8xl font-black tracking-tighter ${isActive ? 'text-[#E0FF00]' : 'text-white/20 group-hover:text-white/40'} transition-colors`}>
                        {isActive ? 'CLICK!' : 'TAP TO START'}
                      </span>
                      {!isActive && (
                        <span className="font-mono text-white/40 tracking-widest text-xs sm:text-sm">SPACEBAR OR CLICK</span>
                      )}
                    </div>
                  </motion.button>
                ) : (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full h-full border-2 border-[#E0FF00] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 sm:p-8 text-center"
                  >
                    <div className="text-7xl sm:text-9xl font-black tracking-tighter text-white mb-1">
                      {finalCps.toFixed(2)}
                    </div>
                    <div className="font-mono text-lg sm:text-xl text-white/50 mb-6">CLICKS PER SECOND</div>
                    
                    <div className="flex items-center gap-3 mb-8">
                      <span className="text-3xl">{rank.icon}</span>
                      <div className={`text-2xl sm:text-4xl font-black tracking-widest ${rank.color}`}>
                        {rank.name}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8 w-full max-w-sm">
                      <div className="p-3 border border-white/10 bg-white/5">
                        <div className="text-[10px] font-mono text-white/50">TOTAL CLICKS</div>
                        <div className="text-xl font-bold text-white">{clicks}</div>
                      </div>
                      <div className="p-3 border border-white/10 bg-white/5">
                        <div className="text-[10px] font-mono text-white/50">AVG HISTORY</div>
                        <div className="text-xl font-bold text-[#E0FF00]">{avgHistory.toFixed(2)}</div>
                      </div>
                    </div>

                    <button
                      onClick={reset}
                      className="px-6 sm:px-8 py-3 sm:py-4 bg-[#E0FF00] text-black font-mono font-bold tracking-widest hover:bg-white transition-colors text-sm sm:text-base"
                    >
                      TRY AGAIN
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {showHistory && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="w-full lg:w-80 border border-white/20 bg-black/60 backdrop-blur-md p-4"
            >
              <div className="flex justify-between items-center mb-4">
                <div className="text-[10px] font-mono tracking-[0.2em] text-white/50">SESSION_HISTORY</div>
                {sessionHistory.length > 0 && (
                  <button 
                    onClick={clearHistory}
                    className="text-[10px] font-mono text-white/30 hover:text-red-400"
                  >
                    CLEAR
                  </button>
                )}
              </div>
              
              {sessionHistory.length === 0 ? (
                <div className="text-center text-white/30 font-mono text-sm py-8">
                  No sessions yet
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {sessionHistory.map((session, i) => (
                    <div key={session.date} className="flex justify-between items-center p-2 border border-white/10 bg-white/5 text-sm">
                      <div className="flex flex-col">
                        <span className="font-mono text-white/50 text-[10px]">{session.duration}s</span>
                        <span className="font-mono text-white/70 text-xs">{session.clicks} clicks</span>
                      </div>
                      <div className="font-mono text-[#E0FF00] font-bold">{session.cps.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </main>

      <section className="w-full max-w-5xl mx-auto px-4 sm:px-8 py-12 sm:py-20 text-white/80 border-t border-white/10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">What is a CPS Test?</h2>
            <p className="leading-relaxed font-mono text-sm sm:text-base">
              A CPS (Clicks Per Second) test measures your clicking speed over a set period of time. 
              It is widely used by gamers to test their hardware and improve their clicking techniques for competitive games like Minecraft PVP.
            </p>
            <h3 className="text-xl font-bold text-white mt-8">Why does CPS matter?</h3>
            <p className="leading-relaxed font-mono text-sm sm:text-base">
              In many competitive games, higher CPS gives you a distinct advantage. It allows for faster attacks, quicker building, and better combo potential. 
              Our tool provides an accurate, lag-free environment to benchmark your speed.
            </p>
          </div>
          
          <div className="space-y-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Clicking Techniques</h2>
            <ul className="space-y-4 font-mono text-sm sm:text-base">
              <li className="p-4 border border-white/10 bg-black/40">
                <strong className="text-[#E0FF00] block mb-1">Regular Clicking (5-8 CPS)</strong>
                The standard way of clicking. Good for precise aiming but lacks the speed needed for high-level competitive play.
              </li>
              <li className="p-4 border border-white/10 bg-black/40">
                <strong className="text-[#E0FF00] block mb-1">Jitter Clicking (10-14 CPS)</strong>
                Involves vibrating your hand or arm muscles to click rapidly. It requires practice to maintain aim while vibrating.
              </li>
              <li className="p-4 border border-white/10 bg-black/40">
                <strong className="text-[#E0FF00] block mb-1">Butterfly Clicking (15-20+ CPS)</strong>
                Using two fingers (usually index and middle) to alternate clicks on the same button. Highly effective on mice that double-click.
              </li>
              <li className="p-4 border border-white/10 bg-black/40">
                <strong className="text-[#E0FF00] block mb-1">Drag Clicking (25+ CPS)</strong>
                Dragging your finger across the mouse button to create friction, registering dozens of clicks instantly. Requires specific mouse surfaces.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="w-full border-t border-white/10 bg-black/80 py-8 text-center">
        <div className="font-mono text-xs sm:text-sm text-white/50 space-y-2">
          <p>© {new Date().getFullYear()} CPS Tester. All rights reserved.</p>
          <p>
            Developed by <a href="https://clujkeebs.com" target="_blank" rel="noopener noreferrer" className="text-[#E0FF00] hover:underline hover:text-white transition-colors">clujkeebs</a>
          </p>
        </div>
      </footer>
    </div>
  );
}