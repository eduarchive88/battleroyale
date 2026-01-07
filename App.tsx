
import React, { useState, useEffect, useRef } from 'react';
import { network } from './services/p2pNetwork';
import { Role, ClassType, Player, Team, GameState, Quiz } from './types';
import { CLASS_BASE_STATS, COSTS, SKILLS_INFO } from './constants';
import { GameCanvas } from './components/GameCanvas';
import { Joystick } from './components/Joystick';

const playSound = (type: 'attack' | 'skill' | 'quiz_ok' | 'quiz_no' | 'phase' | 'click' | 'victory') => {
  const sounds: Record<string, string> = {
    attack: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
    skill: 'https://assets.mixkit.co/active_storage/sfx/2581/2581-preview.mp3',
    quiz_ok: 'https://assets.mixkit.co/active_storage/sfx/1070/1070-preview.mp3',
    quiz_no: 'https://assets.mixkit.co/active_storage/sfx/1071/1071-preview.mp3',
    phase: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
    click: 'https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3',
    victory: 'https://assets.mixkit.co/active_storage/sfx/2020/2020-preview.mp3'
  };
  const audio = new Audio(sounds[type]);
  audio.volume = 0.4;
  audio.play().catch(() => {});
};

const App: React.FC = () => {
  const [view, setView] = useState<'landing' | 'host_setup' | 'host_lobby' | 'lobby' | 'game'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [quizList, setQuizList] = useState<Quiz[]>([]);
  const [newQuiz, setNewQuiz] = useState<Quiz>({ question: '', options: ['', '', '', ''], answer: 0 });
  const [pendingSelection, setPendingSelection] = useState<{ teamId: string, role: Role, classType?: ClassType } | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  const [gameState, setGameState] = useState<GameState>({
    isStarted: false,
    teams: {},
    players: {},
    quizzes: [],
    currentQuizIndex: 0,
    phase: 'QUIZ',
    timer: 30
  });

  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isHost) {
      network.setActionListener((action: any) => handleHostAction(action));
    }
  }, [isHost]);

  useEffect(() => {
    if (!isHost && gameState.isStarted && view === 'lobby') setView('game');
  }, [gameState.isStarted, isHost, view]);

  useEffect(() => {
    if (isHost && gameState.isStarted && gameState.phase !== 'GAME_OVER') {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setGameState(prev => {
          if (prev.timer <= 0) return proceedToNextPhase(prev);
          
          const now = Date.now();
          const newState = JSON.parse(JSON.stringify(prev)) as GameState;
          
          Object.values(newState.teams).forEach(t => {
            t.activeEffects = t.activeEffects.filter(e => e.until > now);
          });
          
          newState.timer = prev.timer - 1;
          network.broadcastState(newState);
          return newState;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isHost, gameState.isStarted, gameState.phase]);

  const proceedToNextPhase = (prev: GameState) => {
    if (prev.phase === 'BATTLE' && prev.currentQuizIndex >= prev.quizzes.length - 1) {
      playSound('victory');
      let winnerId = '';
      let maxScore = -1;
      Object.values(prev.teams).forEach(t => {
        if (t.isDead) return;
        const score = (t.totalDamageDealt || 0) * 0.5 + t.points + t.hp * 0.2;
        if (score > maxScore) { maxScore = score; winnerId = t.id; }
      });
      const endState: GameState = { ...prev, phase: 'GAME_OVER', winnerTeamId: winnerId };
      network.broadcastState(endState);
      return endState;
    }
    const nextPhase = prev.phase === 'QUIZ' ? 'BATTLE' : 'QUIZ';
    const nextQuizIdx = prev.phase === 'BATTLE' ? prev.currentQuizIndex + 1 : prev.currentQuizIndex;
    const newState = JSON.parse(JSON.stringify(prev)) as GameState;
    newState.phase = nextPhase;
    newState.currentQuizIndex = nextQuizIdx;
    newState.timer = 30;
    Object.keys(newState.players).forEach(k => newState.players[k].hasSubmittedQuiz = false);
    Object.values(newState.teams).forEach(t => {
      t.activeEffects = [];
      t.mp = Math.min(t.maxMp, t.mp + 20);
    });
    playSound('phase');
    network.broadcastState(newState);
    return newState;
  };

  const handleHostAction = (action: any) => {
    setGameState(prev => {
      let newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const { type, payload } = action;
      const now = Date.now();

      switch (type) {
        case 'CONFIRM_SELECTION': {
          const { player } = payload;
          newState.players[player.id] = player;
          const classToUse = player.role === Role.COMBAT ? player.classType : ClassType.WARRIOR;
          const base = CLASS_BASE_STATS[classToUse];
          if (!newState.teams[player.teamId]) {
            newState.teams[player.teamId] = {
              id: player.teamId, name: `${player.teamId} 가문`, points: 0,
              hp: base.hp, maxHp: base.hp, mp: base.mp, maxMp: base.mp,
              x: Math.random() * 800 + 100, y: Math.random() * 800 + 100, angle: 0,
              isDead: false, classType: classToUse, stats: { ...base },
              items: { weapon: false, armor: false, boots: false },
              unlockedSkills: [], activeEffects: [], skillCooldowns: {}, lastAtkTime: 0, totalDamageDealt: 0
            };
          } else if (player.role === Role.COMBAT) {
            newState.teams[player.teamId].classType = classToUse;
            newState.teams[player.teamId].hp = base.hp;
            newState.teams[player.teamId].maxHp = base.hp;
            newState.teams[player.teamId].stats = { ...base };
          }
          break;
        }
        case 'CANCEL_SELECTION': {
          delete newState.players[payload.playerId];
          if (!Object.values(newState.players).some(p => (p as Player).teamId === payload.teamId)) delete newState.teams[payload.teamId];
          break;
        }
        case 'MOVE': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            const speedMult = t.activeEffects.some(e => e.type === 'w_speed') ? 2 : 1;
            t.x = Math.max(0, Math.min(1000, t.x + payload.dir.x * t.stats.speed * 4 * speedMult));
            t.y = Math.max(0, Math.min(1000, t.y + payload.dir.y * t.stats.speed * 4 * speedMult));
            if (payload.dir.x !== 0 || payload.dir.y !== 0) t.angle = Math.atan2(payload.dir.y, payload.dir.x) * (180 / Math.PI);
          }
          break;
        }
        case 'ATTACK': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            t.lastAtkTime = now;
            playSound('attack');
            const rangeMult = t.activeEffects.some(e => e.type === 'a_range') ? 2.5 : 1;
            const atkMult = t.activeEffects.some(e => e.type === 'w_double') ? 2 : 1;
            const attackerAngleRad = t.angle * (Math.PI / 180);
            
            Object.values(newState.teams).forEach((target: any) => {
              if (target.id === t.id || target.isDead) return;
              const dx = target.x - t.x; const dy = target.y - t.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const angleToTarget = Math.atan2(dy, dx);
              const angleDiff = Math.abs(angleToTarget - attackerAngleRad);
              const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));

              let isHit = false;
              if (t.classType === ClassType.WARRIOR || t.classType === ClassType.ROGUE) {
                if (dist < t.stats.range * rangeMult && Math.abs(normalizedDiff) < Math.PI / 3) isHit = true;
              } else {
                if (dist < t.stats.range * rangeMult && Math.abs(normalizedDiff) < 0.25) isHit = true;
              }

              if (isHit) {
                if (target.activeEffects.some((e: any) => e.type === 'w_invinc')) return;
                const damage = Math.max(8, (t.stats.atk * atkMult) - target.stats.def);
                target.hp = Math.max(0, target.hp - damage);
                t.totalDamageDealt = (t.totalDamageDealt || 0) + damage;
                if (target.hp <= 0) target.isDead = true;
                t.points += 2;
              }
            });
          }
          break;
        }
        case 'SUPPORT_ACTION': {
          const t = newState.teams[payload.teamId];
          if (!t || t.points < payload.cost) return newState;
          t.points -= payload.cost;
          playSound('click');
          if (payload.action === 'ITEM') {
            (t.items as any)[payload.item] = true;
            if (payload.item === 'weapon') t.stats.atk += 15;
            if (payload.item === 'armor') t.stats.def += 10;
            if (payload.item === 'boots') t.stats.speed += 1.5;
          } else if (payload.action === 'STAT') {
            if (payload.stat === 'hp') t.hp = Math.min(t.maxHp, t.hp + 60);
            if (payload.stat === 'mp') t.mp = Math.min(t.maxMp, t.mp + 60);
            if (payload.stat === 'revive') { t.isDead = false; t.hp = 80; }
            if (payload.stat === 'atk') t.stats.atk += 8;
            if (payload.stat === 'def') t.stats.def += 8;
          } else if (payload.action === 'SKILL') {
            if (!t.unlockedSkills.includes(payload.skillId)) t.unlockedSkills.push(payload.skillId);
          }
          break;
        }
        case 'SKILL_USE': {
          const t = newState.teams[payload.teamId];
          const skill = SKILLS_INFO[t.classType].find(s => s.id === payload.skId);
          if (!t || !skill || t.isDead || t.mp < skill.mp) return newState;
          if (now < (t.skillCooldowns[payload.skId] || 0)) return newState;

          t.mp -= skill.mp;
          t.skillCooldowns[payload.skId] = now + 5000;
          playSound('skill');

          if (['w_speed', 'w_invinc', 'w_double', 'r_hide', 'a_range'].includes(skill.id)) {
            t.activeEffects.push({ type: skill.id, until: now + 2000 });
          } else {
            t.activeEffects.push({ type: skill.id, until: now + 500 });
            if (skill.id === 'm_thunder') {
              Object.values(newState.teams).forEach((target: any) => {
                if (target.id === t.id || target.isDead) return;
                const dist = Math.sqrt((target.x - t.x)**2 + (target.y - t.y)**2);
                if (dist < 400) { target.hp = Math.max(0, target.hp - (t.stats.atk * 3.5)); if(target.hp===0) target.isDead=true; }
              });
            }
          }
          break;
        }
        case 'QUIZ_ANSWER': {
          const p = newState.players[payload.playerId];
          if (p && !p.hasSubmittedQuiz) {
            p.hasSubmittedQuiz = true;
            if (payload.correct) { newState.teams[payload.teamId].points += 20; playSound('quiz_ok'); }
            else { newState.teams[payload.teamId].points += 5; playSound('quiz_no'); }
          }
          break;
        }
        case 'SKIP_PHASE': return proceedToNextPhase(newState);
        case 'ADJUST_TIMER': newState.timer = Math.max(0, newState.timer + payload.amount); break;
      }
      network.broadcastState(newState);
      return newState;
    });
  };

  const downloadCSVTemplate = () => {
    const header = "question,option1,option2,option3,option4,answer(1-4)\n";
    const example = "사과는 영어로?,Apple,Banana,Cherry,Date,1\n중세시대 기사의 주무기는?,활,지팡이,칼,방패,3";
    const blob = new Blob([header + example], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'edu_arena_quiz_template.csv';
    link.click();
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').slice(1);
      const loaded = lines.filter(l => l.trim()).map(line => {
        const parts = line.split(',');
        if (parts.length < 6) return null;
        return {
          question: parts[0].trim(),
          options: [parts[1], parts[2], parts[3], parts[4]].map(o => o.trim()),
          answer: (parseInt(parts[5].trim()) || 1) - 1
        };
      }).filter((q): q is Quiz => q !== null);
      setQuizList(prev => [...prev, ...loaded]);
      alert(`${loaded.length}개의 퀴즈가 성공적으로 성전에 기록되었습니다.`);
    };
    reader.readAsText(file);
  };

  const createRoom = () => {
    const finalCode = (customCode || roomCode).toUpperCase();
    if (!finalCode) return alert("전장의 성호를 정해주십시오.");
    setIsConnecting(true);
    network.init(finalCode, true, setGameState, () => {
      setIsHost(true); setIsConnecting(false); setRoomCode(finalCode);
      const initial = { isStarted: false, players: {}, teams: {}, quizzes: quizList, currentQuizIndex: 0, phase: 'QUIZ', timer: 30, roomCode: finalCode } as GameState;
      setGameState(initial); network.broadcastState(initial); setView('host_lobby');
    });
  };

  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#0a0a0a] text-amber-100 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <div className="text-center mb-16">
          <h1 className="text-9xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-700 drop-shadow-[0_10px_10px_rgba(0,0,0,1)] animate-pulse mb-4 tracking-tighter">EDU ARENA</h1>
          <p className="text-amber-600 font-bold tracking-[0.8em] uppercase text-sm border-y border-amber-900/40 py-2 inline-block">Legendary Chronicles</p>
        </div>
        <div className="w-full max-w-md p-10 bg-slate-900 border-double border-8 border-amber-900 shadow-2xl space-y-8">
          <div className="space-y-4">
            <input className="w-full p-5 bg-black border border-amber-900 rounded-none font-bold text-amber-200 focus:ring-2 ring-amber-600 outline-none" placeholder="용사의 명칭" value={userName} onChange={e => setUserName(e.target.value)} />
            <input className="w-full p-5 bg-black border border-amber-900 rounded-none font-black uppercase text-amber-200 focus:ring-2 ring-amber-600 outline-none" placeholder="비밀 성호" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button onClick={() => { if(!userName) return alert("성호를 입력하십시오."); setIsConnecting(true); network.init(roomCode.toUpperCase(), false, setGameState, () => { setIsConnecting(false); setView('lobby'); }); }} className="w-full py-6 bg-amber-800 hover:bg-amber-700 border-4 border-amber-600 font-black text-2xl text-white transition-all shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] active:scale-95">성전에 입장</button>
          </div>
          <button onClick={() => setView('host_setup')} className="w-full py-2 text-amber-900 font-bold hover:text-amber-500 transition-colors text-xs tracking-[0.5em] uppercase">전장 설계자(Host) 진입</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="flex flex-col h-screen bg-[#0a0a0a] text-amber-100 p-4 md:p-10 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <div className="flex justify-between items-center mb-4 md:mb-6 border-b-4 border-amber-900 pb-2 md:pb-4">
          <h2 className="text-3xl md:text-5xl font-black text-amber-600 italic tracking-tighter">전장 설계자 성소</h2>
          <button onClick={() => setView('landing')} className="text-amber-800 hover:text-amber-400 font-bold text-xs md:text-sm tracking-widest uppercase underline">봉인 해제 (뒤로)</button>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 flex-1 overflow-hidden min-h-0">
          <div className="bg-slate-900 p-4 md:p-8 border-double border-4 md:border-8 border-amber-900 flex flex-col gap-4 md:gap-6 shadow-2xl overflow-y-auto custom-scrollbar">
            <h3 className="text-xl md:text-2xl font-black text-amber-500 border-b border-amber-900/50 pb-2 flex items-center gap-2 sticky top-0 bg-slate-900 z-10"><span>✍️</span> 고대 퀴즈 기록</h3>
            <div className="space-y-4">
              <input className="w-full p-3 md:p-4 bg-black border border-amber-900 text-amber-200 font-bold outline-none focus:border-amber-500" placeholder="성전의 질문을 입력하십시오" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
              <div className="grid grid-cols-1 gap-3 md:gap-4 bg-black/40 p-4 md:p-5 border border-amber-900/30">
                <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest">선택지와 정답 체크</p>
                {newQuiz.options.map((o, i) => (
                  <div key={i} className="flex gap-3 md:gap-4 items-center group">
                    <input type="radio" name="correctAnswer" checked={newQuiz.answer === i} onChange={() => setNewQuiz({...newQuiz, answer: i})} className="w-5 h-5 md:w-6 md:h-6 accent-amber-500 cursor-pointer" title="정답으로 설정" />
                    <input className={`flex-1 p-2 md:p-3 bg-black border ${newQuiz.answer === i ? 'border-amber-500' : 'border-amber-900'} text-[10px] md:text-xs text-amber-200 outline-none transition-colors`} placeholder={`선택지 ${i+1}`} value={o} onChange={e => { const opts = [...newQuiz.options]; opts[i] = e.target.value; setNewQuiz({...newQuiz, options: opts}); }} />
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => { if(newQuiz.question) { setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); } }} className="w-full py-4 md:py-5 bg-amber-800 font-black border-4 border-amber-600 text-white shadow-lg active:scale-95 hover:bg-amber-700">지혜의 서에 봉인</button>
            <div className="grid grid-cols-2 gap-3 md:gap-4 mt-2">
              <button onClick={downloadCSVTemplate} className="py-2 md:py-3 bg-slate-950 text-[10px] font-black border border-amber-900 hover:bg-amber-900/20 text-amber-600 uppercase tracking-widest">양식 문서 하사</button>
              <button onClick={() => fileInputRef.current?.click()} className="py-2 md:py-3 bg-slate-950 text-[10px] font-black border border-amber-900 hover:bg-amber-900/20 text-amber-600 uppercase tracking-widest">외부 문서 봉인</button>
              <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleCSVUpload} />
            </div>
          </div>
          
          <div className="bg-slate-950 p-4 md:p-10 border-double border-4 md:border-8 border-amber-950 overflow-y-auto custom-scrollbar shadow-inner relative hidden lg:block">
            <h3 className="text-xl md:text-2xl font-black mb-6 border-b-2 border-amber-900 pb-2 text-amber-700 sticky top-0 bg-slate-950 z-10 uppercase tracking-tighter">봉인된 지혜의 목록 ({quizList.length})</h3>
            <div className="space-y-4">
              {quizList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-20 py-20">
                  <span className="text-8xl md:text-9xl mb-4">📜</span>
                  <p className="font-black italic">아직 기록된 지혜가 없습니다...</p>
                </div>
              ) : quizList.map((q, i) => (
                <div key={i} className="p-4 md:p-5 bg-black border-l-8 border-amber-800 mb-4 flex justify-between items-start group hover:border-amber-500 transition-all">
                  <div className="text-sm">
                    <span className="text-amber-900 mr-3 font-mono text-lg md:text-xl font-black">#{i+1}</span>
                    <span className="font-bold text-amber-100">{q.question}</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {q.options.map((opt, idx) => (
                        <span key={idx} className={`text-[8px] md:text-[9px] px-2 py-0.5 border ${idx === q.answer ? 'bg-amber-900/40 border-amber-500 text-amber-200' : 'border-amber-900/30 text-amber-800'}`}>{opt}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setQuizList(quizList.filter((_, idx) => idx !== i))} className="text-red-900 hover:text-red-500 font-black text-xs uppercase tracking-tighter ml-2">소멸</button>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="mt-6 md:mt-10 flex flex-col md:flex-row gap-4 md:gap-6 pb-2">
          <input className="flex-1 p-4 md:p-6 bg-slate-900 border-double border-4 md:border-8 border-amber-900 rounded-none text-2xl md:text-4xl font-black uppercase text-center text-amber-200 focus:ring-4 ring-amber-600 outline-none" placeholder="새로운 성지의 함자" value={customCode} onChange={e => setCustomCode(e.target.value)} />
          <button onClick={createRoom} className="px-12 md:px-24 py-4 md:py-0 bg-amber-800 border-4 border-amber-400 font-black text-xl md:text-3xl text-white shadow-2xl hover:bg-amber-700 active:scale-95 transition-all">전장의 문 개방</button>
        </div>
      </div>
    );
  }

  if (view === 'host_lobby') {
    return (
      <div className="h-screen bg-[#0a0a0a] text-amber-100 flex flex-col p-10 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <div className="flex justify-between items-center mb-10 bg-slate-900 p-12 border-double border-[12px] border-amber-900 shadow-2xl">
          <div>
            <p className="text-amber-700 text-sm font-black uppercase mb-1 tracking-[0.5em]">Ancient Portal Seal</p>
            <h2 className="text-9xl font-mono font-black text-amber-200 drop-shadow-[0_0_20px_rgba(251,191,36,0.3)]">{gameState.roomCode}</h2>
          </div>
          <button onClick={() => { playSound('phase'); const ns = { ...gameState, isStarted: true }; setGameState(ns); network.broadcastState(ns); setView('game'); }} className="px-24 py-12 bg-amber-800 border-4 border-amber-500 font-black text-5xl text-white hover:bg-amber-700 hover:scale-105 transition-all shadow-[0_0_60px_rgba(180,83,9,0.6)] uppercase tracking-tighter">원정의 시작</button>
        </div>
        <div className="grid grid-cols-3 gap-8 overflow-y-auto flex-1 custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            const teamPlayers = Object.values(gameState.players).filter(p => (p as Player).teamId === tId.toString());
            return (
              <div key={tId} className={`p-8 border-4 transition-all shadow-xl ${teamPlayers.length > 0 ? 'bg-slate-900 border-amber-600' : 'bg-black border-amber-900/10 opacity-30'}`}>
                <h3 className="text-3xl font-black italic mb-6 border-b-2 border-amber-900 pb-2 text-amber-700 uppercase tracking-tighter">{tId}번 가문의 보루</h3>
                {teamPlayers.length === 0 ? <p className="text-xs italic text-amber-950 font-bold">집결 대기 중...</p> : teamPlayers.map(p_raw => {
                  const p = p_raw as Player;
                  return (
                    <div key={p.id} className="flex justify-between bg-black/60 p-4 mb-3 border-l-8 border-amber-800 hover:border-amber-400 transition-colors">
                      <span className="font-black text-amber-100 text-lg">{p.name}</span>
                      <span className={`px-3 py-1 rounded-none text-[10px] font-black text-white uppercase ${p.role === Role.COMBAT ? 'bg-red-950' : p.role === Role.QUIZ ? 'bg-blue-950' : 'bg-emerald-950'}`}>{p.role}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (view === 'lobby') {
    const players = Object.values(gameState.players);
    return (
      <div className="h-screen bg-[#0a0a0a] text-amber-100 p-10 flex flex-col items-center bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <h2 className="text-7xl font-black italic mb-12 text-amber-600 drop-shadow-lg tracking-tighter">가문과 가호의 선택</h2>
        {myPlayer ? (
          <div className="bg-slate-900 p-20 border-double border-[16px] border-amber-900 text-center animate-in zoom-in shadow-2xl relative">
            <div className="absolute top-4 left-4 text-4xl opacity-20">🔱</div>
            <div className="absolute bottom-4 right-4 text-4xl opacity-20">🔱</div>
            <p className="text-6xl font-black mb-8 text-amber-200 italic tracking-tighter">서약이 성립되었습니다!</p>
            <p className="text-amber-700 font-black mb-12 tracking-[0.5em] animate-pulse uppercase text-sm">마스터의 진격 신호를 대기 중...</p>
            <div className="text-left bg-black/50 p-10 border-4 border-amber-950 mb-12 space-y-4 shadow-inner">
              <p className="font-black text-3xl text-amber-100 border-b border-amber-900/50 pb-2">{myPlayer.teamId}번 가문 소속</p>
              <p className="font-bold text-xl text-amber-600 tracking-widest uppercase">부여된 권능: {myPlayer.role}</p>
              {myPlayer.role === Role.COMBAT && <p className="font-bold text-xl text-amber-600 tracking-widest uppercase">클래스: {myPlayer.classType}</p>}
            </div>
            <button onClick={() => { network.sendAction({ type: 'CANCEL_SELECTION', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId } }); setMyPlayer(null); }} className="px-12 py-4 bg-red-900 border-4 border-red-600 font-black text-white hover:bg-red-800 shadow-lg active:scale-95 transition-all">서약의 파기</button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-8 max-w-[1400px] w-full overflow-y-auto custom-scrollbar pr-6 pb-40">
            {[1,2,3,4,5,6,7,8,9].map(tId => {
              const teamP = players.filter(p => (p as Player).teamId === tId.toString()) as Player[];
              const qT = teamP.some(p => p.role === Role.QUIZ);
              const cT = teamP.some(p => p.role === Role.COMBAT);
              const sC = teamP.filter(p => p.role === Role.SUPPORT).length;
              return (
                <div key={tId} className="bg-slate-900 p-8 border-4 border-amber-900/60 shadow-2xl relative group hover:border-amber-500 transition-all">
                  <h3 className="text-4xl font-black mb-8 italic border-b-2 border-amber-900/40 pb-3 text-amber-100 tracking-tighter group-hover:text-amber-400">{tId}번 가문</h3>
                  <div className="space-y-4">
                    <button disabled={qT} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })} className={`w-full p-5 font-black text-lg flex justify-between border-2 transition-all shadow-md ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'bg-amber-800 border-amber-200 scale-105' : 'bg-black border-amber-900/30 disabled:opacity-20 hover:border-amber-700'}`}>📜 지략가 {qT && '✔'}</button>
                    <button disabled={sC >= 2} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })} className={`w-full p-5 font-black text-lg flex justify-between border-2 transition-all shadow-md ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'bg-amber-800 border-amber-200 scale-105' : 'bg-black border-amber-900/30 disabled:opacity-20 hover:border-amber-700'}`}>🛡️ 조력자 ({sC}/2)</button>
                    <div className="pt-6 border-t border-amber-900/20 mt-4">
                       <p className="text-[10px] font-black text-amber-800 mb-4 uppercase tracking-[0.4em]">기사단 선발</p>
                       <div className="grid grid-cols-2 gap-3">
                          {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => (
                            <button key={ct} disabled={cT} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })} className={`p-4 text-[12px] font-black border-2 transition-all shadow-sm ${pendingSelection?.classType === ct && pendingSelection?.teamId === tId.toString() ? 'bg-amber-800 border-amber-200 scale-110 z-10' : 'bg-black border-amber-950 disabled:opacity-10 hover:border-amber-800'}`}>
                              {ct === ClassType.WARRIOR ? '🗡️ 전사' : ct === ClassType.MAGE ? '🔮 마술사' : ct === ClassType.ARCHER ? '🏹 궁수' : '👤 도적'}
                            </button>
                          ))}
                       </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!myPlayer && (
          <button disabled={!pendingSelection} onClick={() => {
            const p = { id: userName, name: userName, teamId: pendingSelection!.teamId, role: pendingSelection!.role, classType: pendingSelection!.classType || ClassType.WARRIOR, points: 0, hasSubmittedQuiz: false } as Player;
            setMyPlayer(p); network.sendAction({ type: 'CONFIRM_SELECTION', payload: { player: p } });
          }} className="fixed bottom-12 px-28 py-10 bg-amber-800 border-double border-[12px] border-amber-500 font-black text-5xl text-white shadow-2xl disabled:opacity-40 hover:bg-amber-700 active:scale-95 transition-all uppercase tracking-tighter">운명에 서약</button>
        )}
      </div>
    );
  }

  if (view === 'game') {
    const isTeacher = isHost;
    const team = myPlayer ? gameState.teams[myPlayer.teamId] : null;
    const currentQuiz = gameState.quizzes[gameState.currentQuizIndex] || { question: "지혜의 두루마리를 펼치는 중...", options: ["-","-","-","-"], answer: 0 };
    
    if (gameState.phase === 'GAME_OVER') {
      const winTeam = gameState.winnerTeamId ? gameState.teams[gameState.winnerTeamId] : null;
      return (
        <div className="fixed inset-0 bg-[#0a0a0a] flex flex-col items-center justify-center p-10 text-amber-100 z-[9999] bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
          <h1 className="text-9xl font-black italic mb-10 text-amber-500 drop-shadow-[0_0_40px_rgba(251,191,36,0.6)] animate-bounce">LEGEND</h1>
          {winTeam ? (
            <div className="text-center space-y-6 bg-slate-900 p-24 border-double border-[16px] border-amber-600 shadow-[0_0_120px_rgba(217,119,6,0.7)] relative">
              <div className="absolute -top-10 -left-10 text-8xl opacity-30">👑</div>
              <p className="text-7xl font-black text-amber-200 tracking-tighter mb-4">{winTeam.name}</p>
              <p className="text-4xl font-bold text-amber-700 tracking-[0.6em] uppercase border-y-2 border-amber-900 py-6">{winTeam.classType} 가문의 영광</p>
              <div className="flex gap-20 justify-center mt-16">
                <div className="text-center"><p className="text-xs text-amber-900 font-black uppercase mb-3 tracking-widest">Renown</p><p className="text-7xl font-black text-amber-500">{winTeam.points}</p></div>
                <div className="text-center"><p className="text-xs text-amber-900 font-black uppercase mb-3 tracking-widest">Valiance</p><p className="text-7xl font-black text-amber-500">{winTeam.totalDamageDealt?.toFixed(0)}</p></div>
              </div>
            </div>
          ) : <p className="text-4xl">모든 영웅이 쓰러졌습니다.</p>}
          <button onClick={() => window.location.reload()} className="mt-24 px-20 py-8 bg-amber-800 border-4 border-amber-500 text-white font-black rounded-none text-4xl shadow-2xl hover:bg-amber-700 active:scale-95">대서사시를 새로 쓰기</button>
        </div>
      );
    }

    return (
      <div className={`fixed inset-0 flex flex-col md:flex-row bg-[#020617] overflow-hidden`}>
        <div className={`flex-1 relative ${gameState.phase === 'QUIZ' ? 'opacity-30 grayscale saturate-0' : ''} transition-all duration-[1500ms]`}>
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer?.teamId} />
          <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-black/90 px-16 py-8 border-double border-[10px] border-amber-900/90 text-center backdrop-blur-xl shadow-2xl z-20">
            <p className="text-[12px] font-black uppercase text-amber-600 tracking-[0.5em] mb-2">{gameState.phase} PHASE</p>
            <p className="text-7xl font-mono font-black text-amber-100 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">{gameState.timer}s</p>
          </div>
          {myPlayer?.role === Role.COMBAT && gameState.phase === 'BATTLE' && team && !team.isDead && (
            <>
              <div className="absolute bottom-16 left-16 scale-[2.0] grayscale-0 z-30 opacity-80"><Joystick onMove={(dir) => network.sendAction({ type: 'MOVE', payload: { teamId: myPlayer.teamId, dir } })} /></div>
              <div className="absolute bottom-16 right-16 flex items-end gap-8 grayscale-0 z-30">
                <div className="flex flex-col gap-6">
                  {team.unlockedSkills.map(skId => {
                    const sk = SKILLS_INFO[team.classType].find(s => s.id === skId);
                    const cd = Math.max(0, Math.ceil(((team.skillCooldowns[skId] || 0) - Date.now()) / 1000));
                    return (
                      <button key={skId} disabled={cd > 0 || team.mp < (sk?.mp || 0)} onClick={() => network.sendAction({ type: 'SKILL_USE', payload: { teamId: myPlayer.teamId, skId } })} className={`px-10 py-6 rounded-none font-black text-lg border-2 transition-all shadow-2xl ${cd > 0 ? 'bg-slate-800 border-slate-700 opacity-40' : 'bg-amber-900 border-amber-400 text-amber-100 hover:bg-amber-700 active:scale-90 shadow-[inset_0_0_15px_rgba(0,0,0,0.7)]'}`}>
                        {sk?.name} {cd > 0 ? `(${cd}s)` : `(${sk?.mp} MP)`}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => network.sendAction({ type: 'ATTACK', payload: { teamId: myPlayer.teamId } })} className="w-56 h-56 bg-red-950 text-white rounded-full font-black text-8xl shadow-[0_0_80px_rgba(220,38,38,0.7)] border-[12px] border-amber-900 active:scale-90 transition-all flex items-center justify-center hover:bg-red-900">⚔️</button>
              </div>
            </>
          )}
        </div>

        <div className={`w-full md:w-[500px] border-l-[12px] border-amber-950 p-10 overflow-y-auto custom-scrollbar bg-slate-900 text-amber-100 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] shadow-[inset_10px_0_30px_rgba(0,0,0,0.5)] z-40`}>
          {isTeacher ? (
            <div className="space-y-10">
              <h3 className="text-5xl font-black italic text-amber-600 border-b-8 border-amber-900 pb-6 uppercase tracking-tighter shadow-sm">Overlord View</h3>
              <div className="bg-black/80 p-10 border-double border-[10px] border-amber-900 space-y-8 shadow-2xl">
                <p className="text-xs font-black text-amber-800 uppercase tracking-[0.4em]">Prophecy in Motion</p>
                <p className="text-3xl font-black leading-tight text-amber-100 italic">" {currentQuiz.question} "</p>
                <button onClick={() => setShowAnswer(!showAnswer)} className="w-full py-5 bg-amber-900/30 border-2 border-amber-900 font-black text-sm uppercase tracking-widest hover:bg-amber-900/50 transition-colors">진리의 성안 {showAnswer ? '봉인' : '개방'}</button>
                {showAnswer && <div className="text-center font-black text-amber-400 text-4xl border-t-2 border-amber-900/50 pt-8 animate-in slide-in-from-bottom shadow-inner">A: {currentQuiz.options[currentQuiz.answer]}</div>}
              </div>
              <div className="grid grid-cols-2 gap-6">
                <button onClick={() => handleHostAction({type:'ADJUST_TIMER', payload:{amount:10}})} className="bg-amber-900/40 border-4 border-amber-600 py-6 font-black text-2xl hover:bg-amber-800 transition-all active:scale-95 shadow-lg">+10s</button>
                <button onClick={() => handleHostAction({type:'ADJUST_TIMER', payload:{amount:-10}})} className="bg-red-950/40 border-4 border-red-900 py-6 font-black text-2xl hover:bg-red-900 transition-all active:scale-95 shadow-lg">-10s</button>
              </div>
              <button onClick={() => handleHostAction({type:'SKIP_PHASE', payload:{}})} className="w-full bg-amber-800 border-8 border-amber-400 py-8 font-black text-3xl shadow-2xl hover:bg-amber-700 active:scale-95 transition-all uppercase tracking-widest">차원 간섭 (Phase Skip)</button>
            </div>
          ) : myPlayer?.role === Role.QUIZ ? (
            <div className="space-y-12">
              <h3 className="text-5xl font-black italic text-amber-600 uppercase tracking-tighter">The Oracle</h3>
              {gameState.phase === 'QUIZ' ? (
                gameState.players[myPlayer.id].hasSubmittedQuiz ? (
                  <div className="text-center py-32 bg-black/60 border-double border-[12px] border-amber-900 shadow-2xl animate-in zoom-in">
                    <p className="text-[10rem] mb-12 opacity-40">📜</p>
                    <p className="font-black text-4xl text-amber-200 tracking-tighter">진언이 성역에 수신되었습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="p-10 bg-black border-4 border-amber-600 font-black text-2xl mb-8 shadow-[inset_0_0_30px_rgba(217,119,6,0.2)] italic leading-relaxed text-amber-100 ring-4 ring-amber-900/30">" {currentQuiz.question} "</div>
                    {currentQuiz.options.map((opt, i) => (
                      <button key={i} onClick={() => network.sendAction({ type: 'QUIZ_ANSWER', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId, correct: i === currentQuiz.answer } })} className="w-full p-8 bg-amber-950/80 border-4 border-amber-800 text-left font-black text-2xl hover:bg-amber-800 hover:border-amber-400 transition-all active:scale-95 shadow-2xl group flex items-center">
                        <span className="bg-amber-400 text-black px-6 py-2 rounded-none mr-8 font-mono font-black group-hover:scale-125 transition-transform shadow-lg">{i+1}</span> 
                        <span className="text-amber-100 group-hover:text-white">{opt}</span>
                      </button>
                    ))}
                  </div>
                )
              ) : <div className="p-32 text-center opacity-30 font-black italic border-8 border-amber-950 bg-black/50 shadow-inner">격동의 전운이 흐르는 중...<br/><br/>현자의 도를 닦으십시오.</div>}
            </div>
          ) : myPlayer?.role === Role.SUPPORT && team ? (
            <div className="space-y-10 pb-32">
              <div className="flex justify-between items-center bg-black p-8 border-double border-[10px] border-amber-900 sticky top-0 z-10 shadow-2xl ring-4 ring-amber-950">
                <h3 className="text-3xl font-black italic text-amber-600 uppercase">The Crafter</h3>
                <span className="bg-amber-400 text-black px-8 py-2 font-black text-3xl shadow-[inset_0_0_15px_rgba(0,0,0,0.4)]">{team.points} P</span>
              </div>
              <div className="space-y-10">
                <section>
                  <p className="text-[12px] font-black text-amber-800 uppercase tracking-[0.6em] mb-6 border-b-2 border-amber-900/40 pb-2">Ancient Relics (4P)</p>
                  <div className="grid grid-cols-3 gap-4">
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'weapon', cost:4}})} className={`p-6 flex flex-col items-center gap-3 border-4 transition-all shadow-xl ${team.items.weapon ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.weapon}><span className="text-5xl">⚔️</span><span className="text-[12px] font-black tracking-widest uppercase">천공검</span></button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'armor', cost:4}})} className={`p-6 flex flex-col items-center gap-3 border-4 transition-all shadow-xl ${team.items.armor ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.armor}><span className="text-5xl">🛡️</span><span className="text-[12px] font-black tracking-widest uppercase">성기갑</span></button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'boots', cost:4}})} className={`p-6 flex flex-col items-center gap-3 border-4 transition-all shadow-xl ${team.items.boots ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.boots}><span className="text-5xl">👟</span><span className="text-[12px] font-black tracking-widest uppercase">비룡화</span></button>
                  </div>
                </section>
                <section>
                  <p className="text-[12px] font-black text-amber-800 uppercase tracking-[0.6em] mb-6 border-b-2 border-amber-900/40 pb-2">Master Spells (6P)</p>
                  <div className="space-y-4">
                    {SKILLS_INFO[team.classType].map(sk => (
                      <button key={sk.id} disabled={team.unlockedSkills.includes(sk.id)} onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'SKILL', skillId:sk.id, cost:6}})} className="w-full p-6 bg-black border-4 border-amber-900 hover:border-amber-500 text-left disabled:opacity-20 group transition-all shadow-lg active:scale-95">
                        <div className="flex justify-between font-black text-lg mb-2"><span className="text-amber-200 group-hover:text-amber-400">{sk.name}</span><span className="text-amber-600 font-mono tracking-tighter">6P</span></div>
                        <p className="text-[11px] text-amber-800 italic leading-snug font-bold group-hover:text-amber-600 transition-colors uppercase tracking-tight">{sk.desc}</p>
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <p className="text-[12px] font-black text-amber-800 uppercase tracking-[0.6em] mb-6 border-b-2 border-amber-900/40 pb-2">Sacred Blessings</p>
                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'hp', cost:3}})} className="p-5 bg-red-950/30 border-4 border-red-900 text-[14px] font-black hover:bg-red-900/50 shadow-md">생명 연성 (3P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'mp', cost:3}})} className="p-5 bg-blue-950/30 border-4 border-blue-900 text-[14px] font-black hover:bg-blue-900/50 shadow-md">마나 농축 (3P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'atk', cost:5}})} className="p-5 bg-amber-950/20 border-4 border-amber-900 text-[14px] font-black hover:bg-amber-900/40 shadow-md">공격 가호 (5P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'def', cost:5}})} className="p-5 bg-amber-950/20 border-4 border-amber-900 text-[14px] font-black hover:bg-amber-900/40 shadow-md">방어 가호 (5P)</button>
                  </div>
                  <button disabled={!team.isDead} onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'revive', cost:8}})} className={`w-full mt-10 py-10 border-double border-[12px] font-black text-3xl transition-all shadow-2xl ${team.isDead ? 'bg-amber-800 border-amber-200 text-white shadow-[0_0_50px_rgba(180,83,9,1)] animate-bounce' : 'bg-black border-amber-950 opacity-20'}`}>⚡ 기적의 소생 (8P)</button>
                </section>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col justify-center items-center gap-14">
              <div className="text-[20rem] drop-shadow-[0_0_80px_rgba(255,255,255,0.15)] grayscale-0 animate-pulse transition-all">
                {team?.classType === ClassType.WARRIOR ? '🗡️' : team?.classType === ClassType.MAGE ? '🔮' : team?.classType === ClassType.ARCHER ? '🏹' : '👤'}
              </div>
              <p className="text-7xl font-black text-amber-600 uppercase italic tracking-[0.2em] border-y-8 border-amber-950 py-8 w-full text-center shadow-lg">{team?.classType}</p>
              <div className="grid grid-cols-2 gap-10 w-full bg-black/90 p-12 border-double border-[12px] border-amber-950 font-black text-center shadow-2xl ring-8 ring-amber-950/50">
                <div><p className="text-xs text-amber-900 uppercase tracking-[0.5em] mb-4">Might (ATK)</p><p className="text-6xl text-amber-100 drop-shadow-[0_0_10px_rgba(251,191,36,0.3)]">{team?.stats.atk}</p></div>
                <div><p className="text-xs text-amber-800 uppercase tracking-[0.5em] mb-4">Warden (DEF)</p><p className="text-6xl text-amber-100 drop-shadow-[0_0_10px_rgba(251,191,36,0.3)]">{team?.stats.def}</p></div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
};
export default App;
