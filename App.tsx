
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
          
          // 버프 만료 필터링
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
              id: player.teamId, name: `${player.teamId} 모둠`, points: 0,
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
            t.x = Math.max(0, Math.min(1000, t.x + payload.dir.x * t.stats.speed * 3.5 * speedMult));
            t.y = Math.max(0, Math.min(1000, t.y + payload.dir.y * t.stats.speed * 3.5 * speedMult));
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
                if (dist < t.stats.range * rangeMult && Math.abs(normalizedDiff) < 0.2) isHit = true;
              }

              if (isHit) {
                if (target.activeEffects.some((e: any) => e.type === 'w_invinc')) return;
                const damage = Math.max(5, (t.stats.atk * atkMult) - target.stats.def);
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
            if (payload.item === 'weapon') t.stats.atk += 12;
            if (payload.item === 'armor') t.stats.def += 10;
            if (payload.item === 'boots') t.stats.speed += 1.5;
          } else if (payload.action === 'STAT') {
            if (payload.stat === 'hp') t.hp = Math.min(t.maxHp, t.hp + 50);
            if (payload.stat === 'mp') t.mp = Math.min(t.maxMp, t.mp + 50);
            if (payload.stat === 'revive') { t.isDead = false; t.hp = 70; }
            if (payload.stat === 'atk') t.stats.atk += 6;
            if (payload.stat === 'def') t.stats.def += 6;
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
                if (dist < 400) { target.hp = Math.max(0, target.hp - (t.stats.atk * 3)); if(target.hp===0) target.isDead=true; }
              });
            }
          }
          break;
        }
        case 'QUIZ_ANSWER': {
          const p = newState.players[payload.playerId];
          if (p && !p.hasSubmittedQuiz) {
            p.hasSubmittedQuiz = true;
            if (payload.correct) { newState.teams[payload.teamId].points += 15; playSound('quiz_ok'); }
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
    const content = "question,option1,option2,option3,option4,answer(1-4)\n사과는 영어로?,Apple,Banana,Cherry,Date,1";
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'quiz_template.csv');
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
        const p = line.split(',');
        return p.length >= 6 ? { 
          question: p[0].trim(), 
          options: [p[1], p[2], p[3], p[4]].map(o => o.trim()), 
          answer: parseInt(p[5].trim()) - 1 
        } : null;
      }).filter((q): q is Quiz => q !== null);
      setQuizList([...quizList, ...loaded]);
    };
    reader.readAsText(file);
  };

  const createRoom = () => {
    const finalCode = (customCode || roomCode).toUpperCase();
    if (!finalCode) return alert("전장의 이름을 정해주세요.");
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
        <div className="text-center mb-12">
          <h1 className="text-9xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-700 drop-shadow-[0_10px_10px_rgba(0,0,0,1)] animate-pulse mb-2">EDU ARENA</h1>
          <p className="text-amber-600 font-bold tracking-[0.8em] uppercase text-sm">Legendary Chronicles</p>
        </div>
        <div className="w-full max-w-md p-10 bg-slate-900 border-double border-8 border-amber-900 shadow-2xl space-y-8">
          <div className="space-y-4">
            <input className="w-full p-4 bg-black border border-amber-900 rounded-none font-bold text-amber-200" placeholder="용사의 이름" value={userName} onChange={e => setUserName(e.target.value)} />
            <input className="w-full p-4 bg-black border border-amber-900 rounded-none font-black uppercase text-amber-200" placeholder="전장 코드" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button onClick={() => { if(!userName) return alert("이름을 입력하십시오."); setIsConnecting(true); network.init(roomCode.toUpperCase(), false, setGameState, () => { setIsConnecting(false); setView('lobby'); }); }} className="w-full py-5 bg-amber-800 hover:bg-amber-700 border-2 border-amber-600 font-black text-2xl text-white transition-all shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]">모험 시작</button>
          </div>
          <button onClick={() => setView('host_setup')} className="w-full py-2 text-amber-900 font-bold hover:text-amber-500 transition-colors text-xs tracking-widest">전장 설계자(Host) 모드</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="flex flex-col h-screen bg-[#0a0a0a] text-amber-100 p-8">
        <h2 className="text-5xl font-black text-amber-600 mb-8 italic tracking-tighter">전장 설계자 서재</h2>
        <div className="grid grid-cols-2 gap-8 flex-1 overflow-hidden">
          <div className="bg-slate-900 p-8 border-4 border-amber-900 flex flex-col gap-6">
            <h3 className="text-2xl font-bold border-b border-amber-900 pb-2">신규 퀴즈 기록</h3>
            <input className="w-full p-4 bg-black border border-amber-900 text-amber-200" placeholder="질문 내용을 입력하세요" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
            <div className="grid grid-cols-1 gap-3">
              {newQuiz.options.map((o, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="radio" checked={newQuiz.answer === i} onChange={() => setNewQuiz({...newQuiz, answer: i})} className="w-5 h-5 accent-amber-600" />
                  <input className="flex-1 p-3 bg-black border border-amber-900 text-xs text-amber-200" placeholder={`보기 ${i+1}`} value={o} onChange={e => { const opts = [...newQuiz.options]; opts[i] = e.target.value; setNewQuiz({...newQuiz, options: opts}); }} />
                </div>
              ))}
            </div>
            <button onClick={() => { if(newQuiz.question) { setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); } }} className="w-full py-4 bg-amber-800 font-bold border-2 border-amber-600 text-white">서적에 기록</button>
            <div className="flex gap-2 pt-4">
              <button onClick={downloadCSVTemplate} className="flex-1 py-2 bg-slate-800 text-[10px] font-bold border border-amber-900">양식 다운로드</button>
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-2 bg-slate-800 text-[10px] font-bold border border-amber-900">CSV 업로드</button>
              <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleCSVUpload} />
            </div>
          </div>
          <div className="bg-slate-950 p-8 border-4 border-amber-900 overflow-y-auto custom-scrollbar">
            <h3 className="text-2xl font-bold mb-4 border-b border-amber-900 pb-2">기록된 퀴즈 목록 ({quizList.length})</h3>
            {quizList.map((q, i) => (
              <div key={i} className="p-4 bg-black border border-amber-950 mb-3 flex justify-between items-center group">
                <div className="text-sm">
                  <span className="text-amber-700 mr-2 font-mono">#{i+1}</span>
                  <span className="font-bold">{q.question}</span>
                </div>
                <button onClick={() => setQuizList(quizList.filter((_, idx) => idx !== i))} className="text-red-900 hover:text-red-500 font-bold">말살</button>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8 flex gap-4">
          <input className="flex-1 p-5 bg-slate-900 border-4 border-amber-900 rounded-none text-3xl font-black uppercase text-center text-amber-200" placeholder="전장 이름 설정" value={customCode} onChange={e => setCustomCode(e.target.value)} />
          <button onClick={createRoom} className="px-16 bg-amber-800 border-4 border-amber-600 font-black text-2xl text-white shadow-lg">차원문 생성</button>
        </div>
      </div>
    );
  }

  if (view === 'host_lobby') {
    return (
      <div className="h-screen bg-[#0a0a0a] text-amber-100 flex flex-col p-10">
        <div className="flex justify-between items-center mb-10 bg-slate-900 p-10 border-double border-8 border-amber-900 shadow-2xl">
          <div>
            <p className="text-amber-700 text-sm font-black uppercase mb-1 tracking-widest">Ancient Portal Key</p>
            <h2 className="text-9xl font-mono font-black text-amber-200">{gameState.roomCode}</h2>
          </div>
          <button onClick={() => { playSound('phase'); const ns = { ...gameState, isStarted: true }; setGameState(ns); network.broadcastState(ns); setView('game'); }} className="px-20 py-10 bg-amber-800 border-4 border-amber-600 font-black text-5xl text-white hover:bg-amber-700 hover:scale-105 transition-all shadow-[0_0_50px_rgba(180,83,9,0.5)]">원정대 출발</button>
        </div>
        <div className="grid grid-cols-3 gap-8 overflow-y-auto flex-1 custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            const teamPlayers = Object.values(gameState.players).filter(p => (p as Player).teamId === tId.toString());
            return (
              <div key={tId} className={`p-6 border-4 transition-all ${teamPlayers.length > 0 ? 'bg-slate-900 border-amber-600' : 'bg-black border-amber-900/20 opacity-40'}`}>
                <h3 className="text-2xl font-black italic mb-4 border-b border-amber-900/50 pb-2">{tId}번 성채</h3>
                {teamPlayers.map(p_raw => {
                  const p = p_raw as Player;
                  return (
                    <div key={p.id} className="flex justify-between bg-black/60 p-3 mb-2 border-l-4 border-amber-700">
                      <span className="font-bold text-amber-200">{p.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black text-white ${p.role === Role.COMBAT ? 'bg-red-900' : p.role === Role.QUIZ ? 'bg-blue-900' : 'bg-emerald-900'}`}>{p.role}</span>
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
      <div className="h-screen bg-[#0a0a0a] text-amber-100 p-8 flex flex-col items-center">
        <h2 className="text-6xl font-black italic mb-12 text-amber-600 drop-shadow-md">모둠과 가문의 문장 선택</h2>
        {myPlayer ? (
          <div className="bg-slate-900 p-16 border-double border-8 border-amber-900 text-center animate-in zoom-in">
            <p className="text-5xl font-black mb-6 text-amber-200 italic">서약 완료!</p>
            <p className="text-amber-700 font-bold mb-10 tracking-widest animate-pulse uppercase">디아스포라의 부름을 기다리는 중...</p>
            <div className="text-left bg-black/50 p-8 border-2 border-amber-900 mb-10 space-y-2">
              <p className="font-black text-xl">가문: {myPlayer.teamId}번 모둠</p>
              <p className="font-bold">임무: {myPlayer.role}</p>
              {myPlayer.role === Role.COMBAT && <p className="font-bold">직업: {myPlayer.classType}</p>}
            </div>
            <button onClick={() => { network.sendAction({ type: 'CANCEL_SELECTION', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId } }); setMyPlayer(null); }} className="px-10 py-3 bg-red-900 border-2 border-red-600 font-bold text-white hover:bg-red-800">서약 파기</button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6 max-w-7xl w-full overflow-y-auto custom-scrollbar pr-4 pb-32">
            {[1,2,3,4,5,6,7,8,9].map(tId => {
              const teamP = players.filter(p => (p as Player).teamId === tId.toString()) as Player[];
              const qT = teamP.some(p => p.role === Role.QUIZ);
              const cT = teamP.some(p => p.role === Role.COMBAT);
              const sC = teamP.filter(p => p.role === Role.SUPPORT).length;
              return (
                <div key={tId} className="bg-slate-900 p-8 border-4 border-amber-900/50 shadow-inner">
                  <h3 className="text-3xl font-black mb-6 italic border-b border-amber-900 pb-2">{tId}번 성채</h3>
                  <div className="space-y-3">
                    <button disabled={qT} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })} className={`w-full p-4 font-black text-sm flex justify-between border-2 transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'bg-amber-700 border-amber-300 scale-105' : 'bg-black border-amber-900 disabled:opacity-30'}`}>📜 지략가 {qT && '✔'}</button>
                    <button disabled={sC >= 2} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })} className={`w-full p-4 font-black text-sm flex justify-between border-2 transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'bg-amber-700 border-amber-300 scale-105' : 'bg-black border-amber-900 disabled:opacity-30'}`}>🛡️ 조력자 ({sC}/2)</button>
                    <div className="pt-4 border-t border-amber-900/30 mt-2">
                       <p className="text-[10px] font-bold text-amber-800 mb-3 uppercase tracking-widest">전투 클래스 선발</p>
                       <div className="grid grid-cols-2 gap-2">
                          {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => (
                            <button key={ct} disabled={cT} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })} className={`p-3 text-[11px] font-black border transition-all ${pendingSelection?.classType === ct && pendingSelection?.teamId === tId.toString() ? 'bg-amber-700 border-amber-300' : 'bg-black border-amber-950 disabled:opacity-20'}`}>
                              {ct === ClassType.WARRIOR ? '🗡️ 전사' : ct === ClassType.MAGE ? '🔮 마법사' : ct === ClassType.ARCHER ? '🏹 궁수' : '👤 도적'}
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
          }} className="fixed bottom-10 px-24 py-8 bg-amber-800 border-4 border-amber-400 font-black text-4xl text-white shadow-2xl disabled:opacity-50 hover:bg-amber-700 transition-all uppercase tracking-tighter">성배에 서약</button>
        )}
      </div>
    );
  }

  if (view === 'game') {
    const isTeacher = isHost;
    const team = myPlayer ? gameState.teams[myPlayer.teamId] : null;
    const currentQuiz = gameState.quizzes[gameState.currentQuizIndex] || { question: "현자의 두루마리를 펼치는 중...", options: ["-","-","-","-"], answer: 0 };
    
    if (gameState.phase === 'GAME_OVER') {
      const winTeam = gameState.winnerTeamId ? gameState.teams[gameState.winnerTeamId] : null;
      return (
        <div className="fixed inset-0 bg-[#0a0a0a] flex flex-col items-center justify-center p-10 text-amber-100 z-[9999] bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
          <h1 className="text-9xl font-black italic mb-10 text-amber-500 drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">CHAMPION</h1>
          {winTeam ? (
            <div className="text-center space-y-4 bg-slate-900 p-20 border-double border-[12px] border-amber-600 shadow-[0_0_100px_rgba(217,119,6,0.5)]">
              <p className="text-6xl font-black text-amber-200">{winTeam.name} 가문</p>
              <p className="text-3xl font-bold text-amber-700 tracking-[0.5em] uppercase border-y border-amber-900 py-4">{winTeam.classType} CLASS</p>
              <div className="flex gap-16 justify-center mt-12">
                <div className="text-center"><p className="text-xs text-amber-800 font-bold uppercase mb-2">Renown</p><p className="text-5xl font-black text-amber-500">{winTeam.points}</p></div>
                <div className="text-center"><p className="text-xs text-amber-800 font-bold uppercase mb-2">Might</p><p className="text-5xl font-black text-amber-500">{winTeam.totalDamageDealt?.toFixed(0)}</p></div>
              </div>
            </div>
          ) : <p className="text-4xl">살아남은 영웅이 없습니다.</p>}
          <button onClick={() => window.location.reload()} className="mt-20 px-16 py-6 bg-amber-800 border-4 border-amber-500 text-white font-black rounded-none text-3xl shadow-lg hover:bg-amber-700">전설을 다시 쓰기</button>
        </div>
      );
    }

    return (
      <div className={`fixed inset-0 flex flex-col md:flex-row bg-[#020617] overflow-hidden`}>
        <div className={`flex-1 relative ${gameState.phase === 'QUIZ' ? 'opacity-40 grayscale' : ''} transition-all duration-1000`}>
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer?.teamId} />
          <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-black/80 px-14 py-6 border-double border-8 border-amber-900/80 text-center backdrop-blur-md shadow-2xl">
            <p className="text-[10px] font-black uppercase text-amber-600 tracking-[0.4em] mb-1">{gameState.phase} PHASE</p>
            <p className="text-6xl font-mono font-black text-amber-100">{gameState.timer}s</p>
          </div>
          {myPlayer?.role === Role.COMBAT && gameState.phase === 'BATTLE' && team && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-150 grayscale-0"><Joystick onMove={(dir) => network.sendAction({ type: 'MOVE', payload: { teamId: myPlayer.teamId, dir } })} /></div>
              <div className="absolute bottom-12 right-12 flex items-end gap-6 grayscale-0">
                <div className="flex flex-col gap-4">
                  {team.unlockedSkills.map(skId => {
                    const sk = SKILLS_INFO[team.classType].find(s => s.id === skId);
                    const cd = Math.max(0, Math.ceil(((team.skillCooldowns[skId] || 0) - Date.now()) / 1000));
                    return (
                      <button key={skId} disabled={cd > 0 || team.mp < (sk?.mp || 0)} onClick={() => network.sendAction({ type: 'SKILL_USE', payload: { teamId: myPlayer.teamId, skId } })} className={`px-8 py-5 rounded-none font-black text-sm border-2 transition-all ${cd > 0 ? 'bg-slate-800 border-slate-600 opacity-50' : 'bg-amber-900 border-amber-400 text-amber-100 hover:bg-amber-800 shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]'}`}>
                        {sk?.name} {cd > 0 ? `(${cd}s)` : `(${sk?.mp} MP)`}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => network.sendAction({ type: 'ATTACK', payload: { teamId: myPlayer.teamId } })} className="w-48 h-48 bg-red-900 text-white rounded-full font-black text-6xl shadow-[0_0_50px_rgba(220,38,38,0.5)] border-8 border-amber-900 active:scale-90 transition-all flex items-center justify-center">⚔️</button>
              </div>
            </>
          )}
        </div>

        <div className={`w-full md:w-[450px] border-l-8 border-amber-950 p-8 overflow-y-auto custom-scrollbar bg-slate-900 text-amber-100 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] shadow-inner`}>
          {isTeacher ? (
            <div className="space-y-8">
              <h3 className="text-4xl font-black italic text-amber-600 border-b-4 border-amber-900 pb-4 uppercase tracking-tighter">Master's Mirror</h3>
              <div className="bg-black/80 p-8 border-4 border-amber-900 space-y-6">
                <p className="text-xs font-bold text-amber-800 uppercase tracking-[0.3em]">Oracle's Current Question</p>
                <p className="text-2xl font-black leading-tight text-amber-100 italic">" {currentQuiz.question} "</p>
                <button onClick={() => setShowAnswer(!showAnswer)} className="w-full py-4 bg-amber-900/20 border-2 border-amber-900 font-bold text-xs uppercase tracking-widest hover:bg-amber-900/40">진실의 눈 {showAnswer ? '감기' : '뜨기'}</button>
                {showAnswer && <p className="text-center font-black text-amber-400 text-2xl border-t border-amber-900 pt-6">A: {currentQuiz.options[currentQuiz.answer]}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => handleHostAction({type:'ADJUST_TIMER', payload:{amount:10}})} className="bg-amber-800/40 border-2 border-amber-600 py-5 font-black text-lg">+10s</button>
                <button onClick={() => handleHostAction({type:'ADJUST_TIMER', payload:{amount:-10}})} className="bg-red-900/40 border-2 border-red-600 py-5 font-black text-lg">-10s</button>
              </div>
              <button onClick={() => handleHostAction({type:'SKIP_PHASE', payload:{}})} className="w-full bg-amber-800 border-4 border-amber-400 py-6 font-black text-2xl shadow-2xl hover:bg-amber-700">시공간 가속</button>
            </div>
          ) : myPlayer?.role === Role.QUIZ ? (
            <div className="space-y-10">
              <h3 className="text-4xl font-black italic text-amber-600 uppercase tracking-tighter">The Sage</h3>
              {gameState.phase === 'QUIZ' ? (
                gameState.players[myPlayer.id].hasSubmittedQuiz ? (
                  <div className="text-center py-24 bg-black/50 border-double border-8 border-amber-900 shadow-inner animate-pulse">
                    <p className="text-8xl mb-8">📜</p>
                    <p className="font-black text-3xl text-amber-200">명계에 지혜가 전달되었습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="p-8 bg-black border-4 border-amber-600 font-bold text-xl mb-6 shadow-inner italic leading-relaxed text-amber-100">" {currentQuiz.question} "</div>
                    {currentQuiz.options.map((opt, i) => (
                      <button key={i} onClick={() => network.sendAction({ type: 'QUIZ_ANSWER', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId, correct: i === currentQuiz.answer } })} className="w-full p-6 bg-amber-950 border-2 border-amber-700 text-left font-black text-lg hover:bg-amber-800 transition-all active:scale-95 shadow-lg group">
                        <span className="bg-amber-400 text-black px-4 py-1 rounded-none mr-6 font-mono font-black group-hover:scale-110 inline-block">{i+1}</span> 
                        <span className="text-amber-100">{opt}</span>
                      </button>
                    ))}
                  </div>
                )
              ) : <div className="p-24 text-center opacity-40 font-black italic border-4 border-amber-950 bg-black/30">격전의 소용돌이...<br/>지혜를 갈고 닦으십시오.</div>}
            </div>
          ) : myPlayer?.role === Role.SUPPORT && team ? (
            <div className="space-y-8 pb-24">
              <div className="flex justify-between items-center bg-black p-6 border-double border-8 border-amber-900 sticky top-0 z-10 shadow-2xl">
                <h3 className="text-2xl font-black italic text-amber-600 uppercase">Artisan</h3>
                <span className="bg-amber-400 text-black px-6 py-1 font-black text-2xl shadow-inner">{team.points} P</span>
              </div>
              <div className="space-y-8">
                <section>
                  <p className="text-[10px] font-black text-amber-800 uppercase tracking-[0.5em] mb-4 border-b border-amber-900/30 pb-1">Legendary Relics (4P)</p>
                  <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'weapon', cost:4}})} className={`p-5 flex flex-col items-center gap-2 border-2 transition-all ${team.items.weapon ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.weapon}><span className="text-3xl">⚔️</span><span className="text-[10px] font-black">신검</span></button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'armor', cost:4}})} className={`p-5 flex flex-col items-center gap-2 border-2 transition-all ${team.items.armor ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.armor}><span className="text-3xl">🛡️</span><span className="text-[10px] font-black">성갑</span></button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'boots', cost:4}})} className={`p-5 flex flex-col items-center gap-2 border-2 transition-all ${team.items.boots ? 'bg-amber-800 border-amber-300' : 'bg-black border-amber-950 opacity-40'}`} disabled={team.items.boots}><span className="text-3xl">👟</span><span className="text-[10px] font-black">비신</span></button>
                  </div>
                </section>
                <section>
                  <p className="text-[10px] font-black text-amber-800 uppercase tracking-[0.5em] mb-4 border-b border-amber-900/30 pb-1">Master Grimoires (6P)</p>
                  <div className="space-y-3">
                    {SKILLS_INFO[team.classType].map(sk => (
                      <button key={sk.id} disabled={team.unlockedSkills.includes(sk.id)} onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'SKILL', skillId:sk.id, cost:6}})} className="w-full p-5 bg-black border-2 border-amber-900 hover:border-amber-600 text-left disabled:opacity-20 group transition-all">
                        <div className="flex justify-between font-black text-sm mb-2"><span className="text-amber-200">{sk.name}</span><span className="text-amber-600 font-mono">6P</span></div>
                        <p className="text-[10px] text-amber-800 italic leading-snug font-bold group-hover:text-amber-500 transition-colors">{sk.desc}</p>
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <p className="text-[10px] font-black text-amber-800 uppercase tracking-[0.5em] mb-4 border-b border-amber-900/30 pb-1">Potions & Blessings</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'hp', cost:3}})} className="p-4 bg-red-950/20 border-2 border-red-900 text-xs font-black hover:bg-red-900/40">생명 수혈 (3P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'mp', cost:3}})} className="p-4 bg-blue-950/20 border-2 border-blue-900 text-xs font-black hover:bg-blue-900/40">정수 주입 (3P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'atk', cost:5}})} className="p-4 bg-amber-900/10 border-2 border-amber-900 text-xs font-black hover:bg-amber-900/30">공격 축복 (5P)</button>
                    <button onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'def', cost:5}})} className="p-4 bg-amber-900/10 border-2 border-amber-900 text-xs font-black hover:bg-amber-900/30">방어 축복 (5P)</button>
                  </div>
                  <button disabled={!team.isDead} onClick={() => network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'revive', cost:8}})} className={`w-full mt-6 py-6 border-double border-8 font-black text-xl transition-all ${team.isDead ? 'bg-amber-700 border-amber-200 text-white shadow-[0_0_30px_rgba(180,83,9,0.8)] animate-bounce' : 'bg-black border-amber-950 opacity-20'}`}>⚡ 영혼 소생 (8P)</button>
                </section>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col justify-center items-center gap-10">
              <div className="text-[16rem] drop-shadow-[0_0_50px_rgba(255,255,255,0.1)] grayscale-0 animate-pulse">
                {team?.classType === ClassType.WARRIOR ? '🗡️' : team?.classType === ClassType.MAGE ? '🔮' : team?.classType === ClassType.ARCHER ? '🏹' : '👤'}
              </div>
              <p className="text-6xl font-black text-amber-600 uppercase italic tracking-widest border-y-4 border-amber-900 py-4 w-full text-center">{team?.classType}</p>
              <div className="grid grid-cols-2 gap-8 w-full bg-black/80 p-10 border-double border-8 border-amber-950 font-black text-center shadow-2xl">
                <div><p className="text-xs text-amber-800 uppercase tracking-widest mb-3">Might (ATK)</p><p className="text-4xl text-amber-200">{team?.stats.atk}</p></div>
                <div><p className="text-xs text-amber-800 uppercase tracking-widest mb-3">Warden (DEF)</p><p className="text-4xl text-amber-200">{team?.stats.def}</p></div>
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
