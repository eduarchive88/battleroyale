
import React, { useState, useEffect, useRef } from 'react';
import { network } from './services/p2pNetwork';
import { Role, ClassType, Player, Team, GameState, Quiz } from './types';
import { CLASS_BASE_STATS, COSTS, SKILLS_INFO } from './constants';
import { GameCanvas } from './components/GameCanvas';
import { Joystick } from './components/Joystick';

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

  // 호스트 전용 타이머 관리
  useEffect(() => {
    if (isHost && gameState.isStarted) {
      timerRef.current = window.setInterval(() => {
        setGameState(prev => {
          const nextTimer = prev.timer - 1;
          if (nextTimer <= 0) {
            const nextPhase = prev.phase === 'QUIZ' ? 'BATTLE' : 'QUIZ';
            const nextQuizIdx = prev.phase === 'BATTLE' ? Math.min(prev.currentQuizIndex + 1, prev.quizzes.length - 1) : prev.currentQuizIndex;
            const newState: GameState = { ...prev, timer: 30, phase: nextPhase, currentQuizIndex: nextQuizIdx };
            network.broadcastState(newState);
            return newState;
          }
          const newState = { ...prev, timer: nextTimer };
          network.broadcastState(newState);
          return newState;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isHost, gameState.isStarted]);

  // PC 키보드 조작 핸들러
  useEffect(() => {
    if (view !== 'game' || !myPlayer || myPlayer.role !== Role.COMBAT) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState.phase !== 'BATTLE') return;
      const key = e.key.toLowerCase();
      let dir = { x: 0, y: 0 };
      if (key === 'w') dir.y = -1;
      if (key === 's') dir.y = 1;
      if (key === 'a') dir.x = -1;
      if (key === 'd') dir.x = 1;

      if (dir.x !== 0 || dir.y !== 0) {
        network.sendAction({ type: 'MOVE', payload: { teamId: myPlayer.teamId, dir } });
      }

      if (key === 'j') network.sendAction({ type: 'ATTACK', payload: { teamId: myPlayer.teamId } });
      
      const team = gameState.teams[myPlayer.teamId];
      if (team && team.unlockedSkills.length > 0) {
        if (key === 'k' && team.unlockedSkills[0]) network.sendAction({ type: 'SKILL_USE', payload: { teamId: myPlayer.teamId, skId: team.unlockedSkills[0] } });
        if (key === 'l' && team.unlockedSkills[1]) network.sendAction({ type: 'SKILL_USE', payload: { teamId: myPlayer.teamId, skId: team.unlockedSkills[1] } });
        if (key === ';' && team.unlockedSkills[2]) network.sendAction({ type: 'SKILL_USE', payload: { teamId: myPlayer.teamId, skId: team.unlockedSkills[2] } });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, myPlayer, gameState.phase, gameState.teams]);

  useEffect(() => {
    if (gameState.isStarted && view !== 'game') setView('game');
  }, [gameState.isStarted]);

  useEffect(() => {
    if (isHost) network.setActionListener(handleHostAction);
  }, [isHost, gameState]);

  const handleHostAction = (action: any) => {
    setGameState(prev => {
      let newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const { type, payload } = action;

      switch (type) {
        case 'CONFIRM_SELECTION': {
          const { player } = payload;
          newState.players[player.id] = player;
          if (!newState.teams[player.teamId]) {
            const base = CLASS_BASE_STATS[player.classType];
            newState.teams[player.teamId] = {
              id: player.teamId, name: `${player.teamId} 모둠`, points: 0,
              hp: base.hp, maxHp: base.hp, mp: base.mp, maxMp: base.mp,
              x: Math.random() * 800 + 100, y: Math.random() * 800 + 100,
              isDead: false, classType: player.classType, stats: { ...base },
              items: { weapon: false, armor: false, boots: false },
              unlockedSkills: [], activeEffects: [], lastAtkTime: 0
            };
          }
          break;
        }
        case 'ADJUST_TIMER': {
          newState.timer = Math.max(0, newState.timer + payload.amount);
          break;
        }
        case 'QUIZ_ANSWER': {
          if (payload.correct) newState.teams[payload.teamId].points += 10;
          else newState.teams[payload.teamId].points += 2;
          break;
        }
        case 'MOVE': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            const speedMult = t.activeEffects.some(e => e.type === 'w_speed') ? 2 : 1;
            t.x = Math.max(0, Math.min(1000, t.x + payload.dir.x * t.stats.speed * 5 * speedMult));
            t.y = Math.max(0, Math.min(1000, t.y + payload.dir.y * t.stats.speed * 5 * speedMult));
          }
          break;
        }
        case 'ATTACK': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            t.lastAtkTime = Date.now();
            const rangeMult = t.activeEffects.some(e => e.type === 'a_range') ? 3 : 1;
            const atkMult = t.activeEffects.some(e => e.type === 'w_double') ? 2 : 1;
            
            Object.values(newState.teams).forEach((target: any) => {
              if (target.id === t.id || target.isDead) return;
              const dist = Math.sqrt((t.x - target.x)**2 + (t.y - target.y)**2);
              if (dist < (t.stats.range * rangeMult)) {
                if (target.activeEffects.some((e: any) => e.type === 'w_invinc')) return;
                const damage = Math.max(5, (t.stats.atk * atkMult) - target.stats.def);
                target.hp = Math.max(0, target.hp - damage);
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
          if (payload.action === 'ITEM') {
            (t.items as any)[payload.item] = true;
            if (payload.item === 'weapon') t.stats.atk += 15;
            if (payload.item === 'armor') t.stats.def += 10;
            if (payload.item === 'boots') t.stats.speed += 2;
          } else if (payload.action === 'SKILL') {
            t.unlockedSkills.push(payload.skillId);
          } else if (payload.action === 'STAT') {
            if (payload.stat === 'hp') t.hp = Math.min(t.maxHp, t.hp + 10);
            if (payload.stat === 'mp') t.mp = Math.min(t.maxMp, t.mp + 10);
            if (payload.stat === 'atk') t.stats.atk += 3;
            if (payload.stat === 'speed') t.stats.speed += 0.5;
            if (payload.stat === 'atkSpeed') t.stats.atkSpeed += 0.2;
            if (payload.stat === 'def') t.stats.def += 2;
          }
          break;
        }
        case 'SKILL_USE': {
          const t = newState.teams[payload.teamId];
          const skill = SKILLS_INFO[t.classType].find(s => s.id === payload.skId);
          if (t && skill && t.mp >= skill.mp && !t.isDead) {
            t.mp -= skill.mp;
            t.activeEffects.push({ type: skill.id, until: Date.now() + 2000 });
            // 즉시 효과 발동류 스킬 처리
            if (skill.id === 'r_tele') {
              const others = Object.values(newState.teams).filter(ot => ot.id !== t.id && !ot.isDead);
              if (others.length > 0) {
                const target = others[Math.floor(Math.random() * others.length)];
                t.x = target.x - 30; t.y = target.y - 30;
              }
            }
          }
          break;
        }
      }
      network.broadcastState(newState);
      return newState;
    });
  };

  const createRoom = () => {
    const codeInput = customCode.trim() || roomCode.trim();
    if (!codeInput) return alert("방 코드를 입력해주세요.");
    const finalCode = codeInput.toUpperCase();
    setIsConnecting(true);
    network.init(finalCode, true, setGameState, () => {
      setIsHost(true);
      setIsConnecting(false);
      setRoomCode(finalCode);
      const initialState: GameState = { 
        isStarted: false, players: {}, teams: {}, 
        quizzes: quizList, currentQuizIndex: 0, phase: 'QUIZ', timer: 30, roomCode: finalCode 
      };
      setGameState(initialState);
      network.broadcastState(initialState);
      setView('host_lobby');
    });
  };

  // --- 기존 UI 유지 섹션 ---
  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#020617] text-white">
        <div className="text-center mb-12">
          <h1 className="text-8xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-blue-300 via-white to-blue-600 drop-shadow-2xl animate-pulse">EDU ARENA</h1>
          <p className="text-blue-400 font-bold tracking-[0.5em] mt-4 uppercase">Fantasy Battle Royale</p>
        </div>
        <div className="w-full max-w-md p-10 bg-slate-900/80 backdrop-blur-xl rounded-[3rem] border-2 border-blue-500/30 shadow-[0_0_50px_rgba(59,130,246,0.2)] space-y-8">
          <div className="space-y-4">
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 font-bold" placeholder="영웅 닉네임" value={userName} onChange={e => setUserName(e.target.value)} />
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 uppercase font-black" placeholder="방 코드" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button onClick={() => {
              setIsConnecting(true);
              network.init(roomCode.toUpperCase(), false, setGameState, () => { setIsConnecting(false); setView('lobby'); });
            }} disabled={isConnecting} className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-2xl transition-all">
              {isConnecting ? '연결 중...' : '입장하기'}
            </button>
          </div>
          <button onClick={() => setView('host_setup')} className="w-full py-4 bg-slate-800/50 hover:bg-slate-800 rounded-2xl font-bold text-slate-500 hover:text-white transition-colors">교사용 전장 설계 (Host)</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="flex flex-col h-screen bg-[#020617] text-white p-10 overflow-y-auto">
        <header className="mb-10 flex justify-between items-center border-b border-white/5 pb-6">
          <h2 className="text-4xl font-black italic text-blue-400">전장 설계자 메뉴</h2>
          <button onClick={() => setView('landing')} className="bg-slate-800 px-6 py-2 rounded-xl text-sm font-bold">뒤로가기</button>
        </header>
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-5 space-y-6">
            <div className="bg-slate-900 p-8 rounded-[3rem] border border-blue-500/20 shadow-2xl space-y-4">
              <h3 className="text-xl font-black mb-6">1. 퀴즈 직접 입력</h3>
              <input className="w-full p-4 bg-black/50 border border-white/5 rounded-xl font-bold outline-none focus:ring-2 ring-blue-500" placeholder="질문" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
              <div className="grid grid-cols-2 gap-3">
                {newQuiz.options.map((opt, i) => (
                  <input key={i} className="p-3 bg-black/50 border border-white/5 rounded-xl text-sm outline-none focus:ring-2 ring-blue-500" placeholder={`보기 ${i+1}`} value={opt} onChange={e => {
                    const opts = [...newQuiz.options];
                    opts[i] = e.target.value;
                    setNewQuiz({...newQuiz, options: opts});
                  }} />
                ))}
              </div>
              <button onClick={() => { if(newQuiz.question) { setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); } }} className="w-full py-4 bg-blue-600 rounded-2xl font-black">퀴즈 추가</button>
            </div>
            <div className="bg-slate-900 p-8 rounded-[3rem] border border-emerald-500/20 shadow-2xl space-y-4 text-center">
              <h3 className="text-xl font-black mb-2">2. CSV 업로드</h3>
              <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={(e) => {
                 const file = e.target.files?.[0];
                 if (!file) return;
                 const reader = new FileReader();
                 reader.onload = (event) => {
                   const text = event.target?.result as string;
                   const lines = text.split('\n').slice(1);
                   const loaded = lines.filter(l => l.trim()).map(line => {
                     const p = line.split(',');
                     return p.length >= 6 ? { question: p[0].trim(), options: [p[1], p[2], p[3], p[4]].map(o => o.trim()), answer: parseInt(p[5]) - 1 } : null;
                   }).filter((q): q is Quiz => q !== null);
                   setQuizList([...quizList, ...loaded]);
                 };
                 reader.readAsText(file);
              }} />
              <button onClick={() => fileInputRef.current?.click()} className="w-full py-4 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-2xl font-bold">파일 선택 (.csv)</button>
            </div>
          </div>
          <div className="col-span-7 space-y-8">
            <div className="bg-slate-950 p-8 rounded-[3rem] border border-white/5 h-[400px] overflow-y-auto custom-scrollbar">
               <h3 className="text-xl font-black mb-6">등록된 퀴즈 리스트 ({quizList.length})</h3>
               {quizList.map((q, i) => (
                 <div key={i} className="p-5 bg-white/5 rounded-2xl mb-3 flex justify-between items-center border border-white/5">
                   <span className="font-bold">{i+1}. {q.question}</span>
                   <button onClick={() => setQuizList(quizList.filter((_, idx) => idx !== i))} className="text-red-500 font-black text-sm">삭제</button>
                 </div>
               ))}
            </div>
            <div className="flex gap-4">
               <input className="flex-1 p-4 bg-slate-900 border border-white/10 rounded-2xl text-center text-2xl font-black uppercase outline-none focus:ring-2 ring-blue-500" placeholder="방 코드 설정" value={customCode} onChange={e => setCustomCode(e.target.value)} />
               <button onClick={createRoom} className="px-10 py-6 bg-blue-600 rounded-2xl font-black text-2xl shadow-xl transition-all">전장 생성</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'host_lobby') {
    // Fix: Type casting to handle unknown properties
    const players = Object.values(gameState.players) as Player[];
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-10">
        <header className="flex justify-between items-center mb-8 bg-slate-900/50 p-8 rounded-[3rem] border border-white/10 shadow-2xl">
          <div>
            <p className="text-blue-500 font-black text-xs tracking-widest uppercase mb-1">Room Code</p>
            <h2 className="text-7xl font-mono font-black">{gameState.roomCode}</h2>
          </div>
          <button onClick={() => {
            const ns = { ...gameState, isStarted: true };
            setGameState(ns);
            network.broadcastState(ns);
          }} className="px-16 py-8 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-4xl animate-pulse transition-all">전투 개시</button>
        </header>
        <div className="flex-1 grid grid-cols-3 gap-8 overflow-y-auto custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            const teamPlayers = players.filter(p => p.teamId === tId.toString());
            return (
              <div key={tId} className={`bg-slate-900/80 p-6 rounded-[2.5rem] border transition-all ${teamPlayers.length > 0 ? 'border-blue-500/50 shadow-xl' : 'border-white/5 opacity-50'}`}>
                <h3 className="text-2xl font-black italic border-b border-white/10 pb-2 mb-4">{tId} 모둠</h3>
                <div className="space-y-2 text-sm text-slate-400">
                  {teamPlayers.length === 0 ? '영웅 대기 중...' : teamPlayers.map(p => (
                    <div key={p.id} className="flex justify-between bg-white/5 p-2 rounded-lg">
                      <span>{p.name}</span>
                      <span className="text-blue-400 font-bold text-xs">{p.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (view === 'lobby') {
    // Fix: Type casting to handle unknown properties
    const players = Object.values(gameState.players) as Player[];
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-6 overflow-hidden">
        <h2 className="text-5xl font-black italic text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-white">모둠 및 클래스 선택</h2>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pb-32">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tId => {
              const teamPlayers = players.filter(p => p.teamId === tId.toString());
              const quizTaken = teamPlayers.some(p => p.role === Role.QUIZ);
              const combatTaken = teamPlayers.some(p => p.role === Role.COMBAT);
              const supporters = teamPlayers.filter(p => p.role === Role.SUPPORT).length;
              const isMyTeam = myPlayer?.teamId === tId.toString();

              return (
                <div key={tId} className={`p-8 rounded-[3.5rem] border-2 transition-all ${isMyTeam ? 'bg-blue-600/20 border-blue-500 shadow-2xl' : 'bg-slate-900 border-white/5'}`}>
                  <h3 className="text-3xl font-black mb-6 italic">{tId} Team</h3>
                  <div className="space-y-3">
                    <button disabled={quizTaken || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })} className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'ring-4 ring-white bg-blue-600' : 'bg-slate-800'}`}>
                      <span>🧠 문제풀이</span><span className="text-xs">{quizTaken ? '점유됨' : '선택'}</span>
                    </button>
                    <button disabled={supporters >= 2 || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })} className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'ring-4 ring-white bg-emerald-600' : 'bg-slate-800'}`}>
                      <span>🛡️ 서포터 ({supporters}/2)</span><span className="text-xs">{supporters >= 2 ? '점유됨' : '선택'}</span>
                    </button>
                    <div className="pt-4 border-t border-white/10 mt-2">
                       <p className="text-[10px] font-black text-slate-500 uppercase mb-3">Combatant Class</p>
                       <div className="grid grid-cols-2 gap-2">
                          {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => {
                            const isPending = pendingSelection?.teamId === tId.toString() && pendingSelection?.classType === ct;
                            return (
                              <button key={ct} disabled={combatTaken || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })} className={`p-3 rounded-xl text-xs font-black transition-all ${isPending ? 'ring-4 ring-white bg-red-600' : 'bg-slate-950'}`}>
                                {ct === ClassType.WARRIOR ? '🛡️ 전사' : ct === ClassType.MAGE ? '🔮 마법사' : ct === ClassType.ARCHER ? '🏹 궁수' : '🗡️ 도적'}
                              </button>
                            );
                          })}
                       </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {!myPlayer && (
          <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#020617] to-transparent flex justify-center">
            <button disabled={!pendingSelection} onClick={() => {
              if (!pendingSelection) return;
              const p: Player = { id: userName, name: userName, teamId: pendingSelection.teamId, role: pendingSelection.role, classType: pendingSelection.classType || ClassType.WARRIOR, points: 0 };
              setMyPlayer(p);
              network.sendAction({ type: 'CONFIRM_SELECTION', payload: { player: p } });
            }} className="w-full max-w-md py-6 rounded-[2.5rem] font-black text-3xl bg-blue-600 shadow-2xl">선택 완료</button>
          </div>
        )}
      </div>
    );
  }

  if (view === 'game') {
    const isTeacher = isHost;
    const team = myPlayer ? gameState.teams[myPlayer.teamId] : null;
    const currentQuiz = gameState.quizzes[gameState.currentQuizIndex] || { question: "준비된 퀴즈가 없습니다.", options: ["-"], answer: 0 };

    return (
      <div className="fixed inset-0 bg-black flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 relative bg-slate-900">
           <GameCanvas teams={gameState.teams} myTeamId={myPlayer?.teamId} />
           
           <div className="absolute top-10 left-1/2 -translate-x-1/2 text-center pointer-events-none">
              <div className="bg-black/80 px-10 py-4 rounded-3xl border-2 border-blue-500 shadow-2xl">
                <p className="text-blue-400 font-black text-xs uppercase tracking-widest">{gameState.phase} PHASE</p>
                <p className="text-5xl font-mono font-black">{gameState.timer}s</p>
              </div>
           </div>

           {isTeacher && (
             <div className="absolute top-10 right-10 flex flex-col gap-2">
               <button onClick={()=>network.sendAction({type:'ADJUST_TIMER', payload:{amount:5}})} className="bg-emerald-600 px-4 py-2 rounded-lg font-bold text-xs">+5초</button>
               <button onClick={()=>network.sendAction({type:'ADJUST_TIMER', payload:{amount:-5}})} className="bg-red-600 px-4 py-2 rounded-lg font-bold text-xs">-5초</button>
             </div>
           )}

           {myPlayer?.role === Role.COMBAT && gameState.phase === 'BATTLE' && team && !team.isDead && (
             <>
               <div className="absolute bottom-10 left-10 scale-125"><Joystick onMove={(dir)=>network.sendAction({type:'MOVE', payload:{teamId:myPlayer.teamId, dir}})} /></div>
               <div className="absolute bottom-10 right-10 flex gap-4 items-end">
                  <div className="grid grid-cols-1 gap-2">
                    {team.unlockedSkills.map((skId, i) => {
                      const sk = SKILLS_INFO[team.classType].find(s => s.id === skId);
                      return (
                        <button key={i} onClick={()=>network.sendAction({type:'SKILL_USE', payload:{teamId:myPlayer.teamId, skId}})} className="px-4 py-2 bg-blue-600 rounded-xl font-bold text-xs border-2 border-white/20">{sk?.name} ({sk?.mp}M)</button>
                      );
                    })}
                  </div>
                  <button onClick={()=>network.sendAction({type:'ATTACK', payload:{teamId:myPlayer.teamId}})} className="w-32 h-32 bg-red-600 rounded-full font-black text-5xl shadow-2xl border-4 border-white/20 active:scale-95">⚔️</button>
               </div>
             </>
           )}
        </div>

        <div className="w-full md:w-96 bg-slate-950 border-l border-white/10 p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
           {myPlayer?.role === Role.QUIZ && (
             <div className="space-y-6">
                <h3 className="text-2xl font-black text-blue-400 italic">TEAM REPORT</h3>
                {gameState.phase === 'QUIZ' ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-900 rounded-xl font-bold border border-white/5">{currentQuiz.question}</div>
                    {currentQuiz.options.map((opt, i) => (
                      <button key={i} onClick={()=>network.sendAction({type:'QUIZ_ANSWER', payload:{teamId:myPlayer.teamId, correct: i===currentQuiz.answer}})} className="w-full p-4 bg-slate-800 hover:bg-blue-600 rounded-xl text-left font-bold text-sm transition-all">{i+1}. {opt}</button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-500 font-black uppercase">전술 현황 브리핑</p>
                    {(Object.values(gameState.teams) as Team[]).map(t => (
                      <div key={t.id} className={`p-4 rounded-xl border ${t.id === myPlayer.teamId ? 'border-blue-500 bg-blue-500/10' : 'bg-slate-900 border-white/5'}`}>
                        <div className="flex justify-between font-black mb-2"><span>{t.name}</span><span className={t.isDead ? 'text-red-500' : 'text-emerald-500'}>{t.isDead ? 'DOWN' : 'ACTIVE'}</span></div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                          <div className="flex justify-between"><span>HP</span><span>{t.hp}/{t.maxHp}</span></div>
                          <div className="flex justify-between"><span>MP</span><span>{t.mp}/{t.maxMp}</span></div>
                          <div className="flex justify-between"><span>ATK</span><span>{t.stats.atk}</span></div>
                          <div className="flex justify-between"><span>SKILLS</span><span>{t.unlockedSkills.length}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
             </div>
           )}

           {myPlayer?.role === Role.SUPPORT && team && (
             <div className="space-y-6">
                <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-white/5">
                   <h3 className="text-xl font-black text-emerald-400">SUPPORT SHOP</h3>
                   <span className="bg-amber-500 text-black px-4 py-1 rounded-full font-black italic">{team.points} P</span>
                </div>
                
                <section className="space-y-3">
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">장비 세트 (4P - 1회 한정)</p>
                   <div className="grid grid-cols-1 gap-2">
                      <button disabled={team.items.weapon} onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'weapon', cost:COSTS.ITEM}})} className="p-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-xl text-xs font-bold flex justify-between"><span>⚔️ 전설의 무기 (+ATK)</span><span>4P</span></button>
                      <button disabled={team.items.armor} onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'armor', cost:COSTS.ITEM}})} className="p-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-xl text-xs font-bold flex justify-between"><span>🛡️ 신성한 방어구 (+DEF)</span><span>4P</span></button>
                      <button disabled={team.items.boots} onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'boots', cost:COSTS.ITEM}})} className="p-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-xl text-xs font-bold flex justify-between"><span>👟 바람의 장화 (+SPD)</span><span>4P</span></button>
                   </div>
                </section>

                <section className="space-y-3">
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">기술 습득 (6P - 1회 한정)</p>
                   <div className="space-y-2">
                      {SKILLS_INFO[team.classType].map(sk => (
                        <button key={sk.id} disabled={team.unlockedSkills.includes(sk.id)} onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'SKILL', skillId:sk.id, cost:COSTS.SKILL}})} className="w-full p-4 bg-slate-800 hover:bg-blue-900 disabled:opacity-30 rounded-xl text-left border border-white/5">
                          <div className="flex justify-between items-center"><span className="font-black text-sm">{sk.name}</span><span className="text-[10px] font-black bg-white/10 px-2 rounded">6P</span></div>
                          <p className="text-[10px] text-slate-400 mt-1">{sk.desc} (소모 MP: {sk.mp})</p>
                        </button>
                      ))}
                   </div>
                </section>

                <section className="space-y-3">
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">무제한 능력치 강화 (3P)</p>
                   <div className="grid grid-cols-2 gap-2">
                      <button onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'hp', cost:COSTS.STAT}})} className="p-3 bg-slate-900 rounded-xl text-xs font-bold">❤️ 체력회복</button>
                      <button onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'mp', cost:COSTS.STAT}})} className="p-3 bg-slate-900 rounded-xl text-xs font-bold">💧 마력회복</button>
                      <button onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'atk', cost:COSTS.STAT}})} className="p-3 bg-slate-900 rounded-xl text-xs font-bold">💥 공격력↑</button>
                      <button onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'def', cost:COSTS.STAT}})} className="p-3 bg-slate-900 rounded-xl text-xs font-bold">🛡️ 방어력↑</button>
                   </div>
                </section>
             </div>
           )}

           {myPlayer?.role === Role.COMBAT && (
             <div className="space-y-6">
                <h3 className="text-2xl font-black text-red-500 italic">COMBAT STATUS</h3>
                <div className="p-8 bg-slate-900 rounded-[3rem] text-center border-2 border-white/5 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-blue-500/20" />
                   <div className="text-9xl mb-4">{team?.classType === ClassType.WARRIOR ? '🛡️' : team?.classType === ClassType.MAGE ? '🔮' : team?.classType === ClassType.ARCHER ? '🏹' : '🗡️'}</div>
                   <p className="font-black uppercase tracking-[0.3em] text-blue-400">{team?.classType}</p>
                </div>
                <div className="space-y-3 bg-black/40 p-6 rounded-3xl">
                   <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-slate-500">HP</span>
                      <div className="w-32 h-3 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                        <div className="h-full bg-red-500 transition-all" style={{width: `${(team?.hp||0)/(team?.maxHp||1)*100}%`}} />
                      </div>
                   </div>
                   <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-slate-500">MP</span>
                      <div className="w-32 h-3 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                        <div className="h-full bg-blue-500 transition-all" style={{width: `${(team?.mp||0)/(team?.maxMp||1)*100}%`}} />
                      </div>
                   </div>
                   <hr className="border-white/5 my-2" />
                   <div className="flex justify-between text-xs font-bold uppercase tracking-widest"><span className="text-slate-500">Attack</span><span>{team?.stats.atk}</span></div>
                   <div className="flex justify-between text-xs font-bold uppercase tracking-widest"><span className="text-slate-500">Defense</span><span>{team?.stats.def}</span></div>
                   <div className="flex justify-between text-xs font-bold uppercase tracking-widest"><span className="text-slate-500">Speed</span><span>{team?.stats.speed}</span></div>
                </div>
                <div className="p-4 bg-white/5 rounded-xl border border-white/5 text-[10px] text-slate-500 font-bold leading-relaxed">
                   [조작 가이드]<br/>
                   WASD: 이동 | J: 공격 | K,L,;: 기술 사용
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