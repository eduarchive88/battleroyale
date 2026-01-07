
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
    if (!isHost && gameState.isStarted && view === 'lobby') {
      setView('game');
    }
  }, [gameState.isStarted, isHost, view]);

  useEffect(() => {
    if (isHost && gameState.isStarted) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setGameState(prev => {
          if (prev.timer <= 0) {
            return proceedToNextPhase(prev);
          }
          const newState = { ...prev, timer: prev.timer - 1 };
          network.broadcastState(newState);
          return newState;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isHost, gameState.isStarted]);

  const proceedToNextPhase = (prev: GameState) => {
    const nextPhase = prev.phase === 'QUIZ' ? 'BATTLE' : 'QUIZ';
    const nextQuizIdx = prev.phase === 'BATTLE' ? Math.min(prev.currentQuizIndex + 1, prev.quizzes.length - 1) : prev.currentQuizIndex;
    const newPlayers = { ...prev.players };
    Object.keys(newPlayers).forEach(k => newPlayers[k].hasSubmittedQuiz = false);
    
    const newTeams = { ...prev.teams };
    (Object.values(newTeams) as Team[]).forEach(t => {
      t.activeEffects = t.activeEffects.filter(e => e.until > Date.now());
    });

    const newState: GameState = { ...prev, timer: 30, phase: nextPhase, currentQuizIndex: nextQuizIdx, players: newPlayers, teams: newTeams };
    network.broadcastState(newState);
    return newState;
  };

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
          
          const classToUse = player.role === Role.COMBAT ? player.classType : ClassType.WARRIOR;
          const base = CLASS_BASE_STATS[classToUse];

          if (!newState.teams[player.teamId]) {
            newState.teams[player.teamId] = {
              id: player.teamId, name: `${player.teamId} 모둠`, points: 0,
              hp: base.hp, maxHp: base.hp, mp: base.mp, maxMp: base.mp,
              x: Math.random() * 800 + 100, y: Math.random() * 800 + 100, angle: 0,
              isDead: false, classType: classToUse, stats: { ...base },
              items: { weapon: false, armor: false, boots: false },
              unlockedSkills: [], activeEffects: [], lastAtkTime: 0
            };
          } else if (player.role === Role.COMBAT) {
            // 전투요원이 들어오면 해당 팀의 클래스 정보를 즉시 갱신 (직업 불일치 해결)
            newState.teams[player.teamId].classType = classToUse;
            newState.teams[player.teamId].hp = base.hp;
            newState.teams[player.teamId].maxHp = base.hp;
            newState.teams[player.teamId].stats = { ...base };
          }
          break;
        }
        case 'CANCEL_SELECTION': {
          const { playerId, teamId } = payload;
          delete newState.players[playerId];
          const remains = Object.values(newState.players).some(p => (p as Player).teamId === teamId);
          if (!remains) delete newState.teams[teamId];
          break;
        }
        case 'SKIP_PHASE': {
          return proceedToNextPhase(newState);
        }
        case 'ADJUST_TIMER': {
          newState.timer = Math.max(0, newState.timer + payload.amount);
          break;
        }
        case 'GIVE_POINT': {
          if (newState.teams[payload.teamId]) newState.teams[payload.teamId].points += payload.amount;
          break;
        }
        case 'QUIZ_ANSWER': {
          const p = newState.players[payload.playerId];
          if (p && !p.hasSubmittedQuiz) {
            p.hasSubmittedQuiz = true;
            if (payload.correct) newState.teams[payload.teamId].points += 10;
            else newState.teams[payload.teamId].points += 2;
          }
          break;
        }
        case 'MOVE': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            const speedMult = t.activeEffects.some(e => e.type === 'w_speed') ? 1.8 : 1;
            t.x = Math.max(0, Math.min(1000, t.x + payload.dir.x * t.stats.speed * 4 * speedMult));
            t.y = Math.max(0, Math.min(1000, t.y + payload.dir.y * t.stats.speed * 4 * speedMult));
            if (payload.dir.x !== 0 || payload.dir.y !== 0) {
              t.angle = Math.atan2(payload.dir.y, payload.dir.x) * (180 / Math.PI);
            }
          }
          break;
        }
        case 'ATTACK': {
          const t = newState.teams[payload.teamId];
          if (t && !t.isDead && newState.phase === 'BATTLE') {
            t.lastAtkTime = Date.now();
            const rangeMult = t.activeEffects.some(e => e.type === 'a_range') ? 2.5 : 1;
            const atkMult = t.activeEffects.some(e => e.type === 'w_double') ? 2 : 1;
            Object.values(newState.teams).forEach((target: any) => {
              if (target.id === t.id || target.isDead) return;
              const dx = target.x - t.x; const dy = target.y - t.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
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
            if (payload.item === 'boots') t.stats.speed += 1.5;
          } else if (payload.action === 'SKILL') {
            t.unlockedSkills.push(payload.skillId);
          } else if (payload.action === 'STAT') {
            if (payload.stat === 'hp') t.hp = Math.min(t.maxHp, t.hp + 20);
            if (payload.stat === 'mp') t.mp = Math.min(t.maxMp, t.mp + 20);
          }
          break;
        }
        case 'SKILL_USE': {
          const t = newState.teams[payload.teamId];
          const skill = SKILLS_INFO[t.classType].find(s => s.id === payload.skId);
          if (t && skill && t.mp >= skill.mp && !t.isDead) {
            if (t.activeEffects.some(e => e.type === skill.id)) return newState;
            t.mp -= skill.mp;
            t.activeEffects.push({ type: skill.id, until: Date.now() + 3000 });
            if (skill.id === 'r_tele') {
              const others = Object.values(newState.teams).filter(ot => ot.id !== t.id && !ot.isDead);
              if (others.length > 0) {
                const target = others[Math.floor(Math.random() * others.length)];
                t.x = target.x - 50; t.y = target.y - 50;
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

  const startBattle = () => {
    const ns = { ...gameState, isStarted: true };
    setGameState(ns);
    network.broadcastState(ns);
    setView('game');
  };

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
              if(!userName) return alert("닉네임을 입력하세요.");
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
    const players = Object.values(gameState.players) as Player[];
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-10">
        <header className="flex justify-between items-center mb-8 bg-slate-900/50 p-8 rounded-[3rem] border border-white/10 shadow-2xl">
          <div>
            <p className="text-blue-500 font-black text-xs tracking-widest uppercase mb-1">Room Code</p>
            <h2 className="text-7xl font-mono font-black">{gameState.roomCode}</h2>
          </div>
          <button onClick={startBattle} className="px-16 py-8 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-4xl animate-pulse transition-all">전투 개시</button>
        </header>
        <div className="flex-1 grid grid-cols-3 gap-8 overflow-y-auto custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            const teamPlayers = players.filter(p => p.teamId === tId.toString());
            return (
              <div key={tId} className={`bg-slate-900/80 p-6 rounded-[2.5rem] border transition-all ${teamPlayers.length > 0 ? 'border-blue-500/50 shadow-xl' : 'border-white/5 opacity-50'}`}>
                <h3 className="text-2xl font-black italic border-b border-white/10 pb-2 mb-4">{tId} 모둠</h3>
                <div className="space-y-2 text-sm text-slate-400">
                  {teamPlayers.length === 0 ? '영웅 대기 중...' : teamPlayers.map(p => (
                    <div key={p.id} className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                      <span className="font-bold text-white">{p.name}</span>
                      <div className="flex flex-col items-end">
                        <span className="text-blue-400 font-black text-[10px] uppercase">{p.role}</span>
                        {p.role === Role.COMBAT && <span className="text-emerald-400 font-black text-[10px] uppercase">직업: {p.classType}</span>}
                      </div>
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
    const players = Object.values(gameState.players) as Player[];
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-6 overflow-hidden">
        <h2 className="text-5xl font-black italic text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-white">모둠 및 클래스 선택</h2>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pb-32">
          {myPlayer ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-8">
               <div className="p-10 bg-slate-900/80 rounded-[3rem] border-2 border-blue-500/50 shadow-[0_0_50px_rgba(59,130,246,0.2)]">
                  <h3 className="text-4xl font-black mb-4">선택을 완료했습니다!</h3>
                  <p className="text-xl text-blue-300 font-bold mb-8 animate-pulse">선생님이 전투를 개시할 때까지 대기하세요...</p>
                  <div className="text-left bg-black/30 p-6 rounded-2xl border border-white/5 mb-8">
                     <p className="text-sm text-slate-400">나의 정보</p>
                     <p className="text-xl font-black">팀: {myPlayer.teamId}모둠</p>
                     <p className="text-xl font-black">역할: {myPlayer.role}</p>
                     {myPlayer.role === Role.COMBAT && <p className="text-xl font-black">직업: {myPlayer.classType}</p>}
                  </div>
                  <button onClick={() => {
                    network.sendAction({ type: 'CANCEL_SELECTION', payload: { playerId: myPlayer.id, teamId: myPlayer.teamId } });
                    setMyPlayer(null);
                  }} className="px-10 py-4 bg-rose-600/20 text-rose-400 border border-rose-500/50 rounded-2xl font-black hover:bg-rose-600 hover:text-white transition-all">선택 취소</button>
               </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tId => {
                const teamPlayers = players.filter(p => p.teamId === tId.toString());
                const quizTaken = teamPlayers.some(p => p.role === Role.QUIZ);
                const combatTaken = teamPlayers.some(p => p.role === Role.COMBAT);
                const supporters = teamPlayers.filter(p => p.role === Role.SUPPORT).length;

                return (
                  <div key={tId} className={`p-8 rounded-[3.5rem] border-2 transition-all bg-slate-900 border-white/5`}>
                    <h3 className="text-3xl font-black mb-6 italic">{tId} Team</h3>
                    <div className="space-y-3">
                      <button disabled={quizTaken} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })} className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'ring-4 ring-white bg-blue-600' : 'bg-slate-800 disabled:opacity-30'}`}>
                        <span>🧠 문제풀이</span><span className="text-xs">{quizTaken ? '점유됨' : '선택'}</span>
                      </button>
                      <button disabled={supporters >= 2} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })} className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'ring-4 ring-white bg-emerald-600' : 'bg-slate-800 disabled:opacity-30'}`}>
                        <span>🛡️ 서포터 ({supporters}/2)</span><span className="text-xs">{supporters >= 2 ? '점유됨' : '선택'}</span>
                      </button>
                      <div className="pt-4 border-t border-white/10 mt-2">
                         <p className="text-[10px] font-black text-slate-500 uppercase mb-3">Combatant Class</p>
                         <div className="grid grid-cols-2 gap-2">
                            {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => {
                              const isPending = pendingSelection?.teamId === tId.toString() && pendingSelection?.classType === ct;
                              return (
                                <button key={ct} disabled={combatTaken} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })} className={`p-3 rounded-xl text-xs font-black transition-all ${isPending ? 'ring-4 ring-white bg-red-600' : 'bg-slate-950 disabled:opacity-30'}`}>
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
          )}
        </div>
        {!myPlayer && (
          <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#020617] to-transparent flex justify-center">
            <button disabled={!pendingSelection} onClick={() => {
              if (!pendingSelection) return;
              const p: Player = { id: userName, name: userName, teamId: pendingSelection.teamId, role: pendingSelection.role, classType: pendingSelection.classType || ClassType.WARRIOR, points: 0, hasSubmittedQuiz: false };
              setMyPlayer(p);
              network.sendAction({ type: 'CONFIRM_SELECTION', payload: { player: p } });
            }} className="w-full max-w-md py-6 rounded-[2.5rem] font-black text-3xl bg-blue-600 shadow-2xl disabled:opacity-50">선택 완료</button>
          </div>
        )}
      </div>
    );
  }

  if (view === 'game') {
    const isTeacher = isHost;
    const team = myPlayer ? gameState.teams[myPlayer.teamId] : null;
    const currentQuiz = gameState.quizzes[gameState.currentQuizIndex] || { question: "준비된 퀴즈가 없습니다.", options: ["-"], answer: 0 };
    const prevQuiz = gameState.currentQuizIndex > 0 ? gameState.quizzes[gameState.currentQuizIndex - 1] : (gameState.phase === 'BATTLE' ? gameState.quizzes[gameState.currentQuizIndex] : null);
    
    const phaseColor = gameState.phase === 'QUIZ' ? 'bg-[#1e1b4b]' : 'bg-[#0f172a]';
    const accentColor = gameState.phase === 'QUIZ' ? 'border-violet-500/50' : 'border-red-500/50';

    return (
      <div className={`fixed inset-0 ${phaseColor} flex flex-col md:flex-row overflow-hidden transition-colors duration-700`}>
        {/* 중앙 전장 영역 */}
        <div className={`flex-1 relative ${gameState.phase === 'QUIZ' ? 'opacity-40 grayscale-[0.5]' : ''} transition-all duration-700`}>
           <GameCanvas teams={gameState.teams} myTeamId={myPlayer?.teamId} />
           
           <div className="absolute top-10 left-1/2 -translate-x-1/2 flex items-center gap-6 pointer-events-none">
              <div className={`bg-black/90 px-12 py-5 rounded-[2.5rem] border-4 ${accentColor} shadow-2xl backdrop-blur-md text-center`}>
                <p className={`${gameState.phase === 'QUIZ' ? 'text-violet-400' : 'text-red-400'} font-black text-sm tracking-[0.3em] uppercase mb-1`}>{gameState.phase} PHASE</p>
                <p className="text-6xl font-mono font-black text-white">{gameState.timer}s</p>
              </div>
           </div>

           {isTeacher && (
             <div className="absolute top-10 right-10 flex flex-col gap-3">
               <div className="flex gap-2">
                 <button onClick={()=>network.sendAction({type:'ADJUST_TIMER', payload:{amount:5}})} className="bg-emerald-600/80 hover:bg-emerald-500 px-6 py-3 rounded-2xl font-black text-sm shadow-xl">+5s</button>
                 <button onClick={()=>network.sendAction({type:'ADJUST_TIMER', payload:{amount:-5}})} className="bg-rose-600/80 hover:bg-rose-500 px-6 py-3 rounded-2xl font-black text-sm shadow-xl">-5s</button>
               </div>
               <button onClick={()=>network.sendAction({type:'SKIP_PHASE', payload:{}})} className="bg-blue-600/80 hover:bg-blue-500 px-6 py-3 rounded-2xl font-black text-sm shadow-xl">다음 단계로 스킵 (Skip)</button>
             </div>
           )}

           {myPlayer?.role === Role.COMBAT && gameState.phase === 'BATTLE' && team && !team.isDead && (
             <>
               <div className="absolute bottom-12 left-12 scale-150"><Joystick onMove={(dir)=>network.sendAction({type:'MOVE', payload:{teamId:myPlayer.teamId, dir}})} /></div>
               <div className="absolute bottom-12 right-12 flex gap-6 items-end">
                  <div className="flex flex-col gap-4">
                    {team.unlockedSkills.map((skId, i) => {
                      const sk = SKILLS_INFO[team.classType].find(s => s.id === skId);
                      const effect = team.activeEffects.find(e => e.type === skId);
                      const timeLeft = effect ? Math.max(0, Math.ceil((effect.until - Date.now()) / 1000)) : 0;
                      return (
                        <button key={i} onClick={()=>network.sendAction({type:'SKILL_USE', payload:{teamId:myPlayer.teamId, skId}})} className={`relative px-6 py-3 rounded-2xl font-black text-xs border-2 transition-all ${timeLeft > 0 ? 'bg-amber-600 border-white scale-110' : 'bg-blue-600 border-white/20'}`}>
                          {sk?.name} {timeLeft > 0 ? `(${timeLeft}s)` : `(${sk?.mp}M)`}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={()=>network.sendAction({type:'ATTACK', payload:{teamId:myPlayer.teamId}})} className="w-40 h-40 bg-red-600 hover:bg-red-500 rounded-full font-black text-6xl shadow-[0_0_50px_rgba(239,68,68,0.4)] border-8 border-white/20 active:scale-90 transition-all">⚔️</button>
               </div>
             </>
           )}
        </div>

        <div className={`w-full md:w-96 ${gameState.phase === 'QUIZ' ? 'bg-[#2e1065]' : 'bg-slate-950'} border-l-4 ${accentColor} p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar transition-colors duration-700`}>
           {isTeacher && (
             <div className="space-y-6">
                <h3 className="text-2xl font-black text-white italic border-b-2 border-white/10 pb-2">HOST DASHBOARD</h3>
                {gameState.phase === 'QUIZ' ? (
                  <>
                    <div className="bg-black/30 p-6 rounded-[2.5rem] border border-violet-400/30">
                      <p className="text-violet-300 font-bold text-xs uppercase mb-4 tracking-tighter">Current Quiz</p>
                      <p className="text-xl font-black leading-tight text-white mb-6">"{currentQuiz.question}"</p>
                      <div className="space-y-2">
                         {currentQuiz.options.map((o, idx) => (
                           <div key={idx} className={`p-3 rounded-xl text-xs font-bold ${idx === currentQuiz.answer && showAnswer ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-white/5 text-white/50'}`}>
                             {idx + 1}. {o}
                           </div>
                         ))}
                      </div>
                      <button onClick={() => setShowAnswer(!showAnswer)} className="mt-4 w-full py-2 bg-white/10 rounded-xl text-xs font-black">{showAnswer ? '정답 숨기기' : '정답 보기'}</button>
                    </div>
                    <div className="bg-black/20 p-6 rounded-3xl border border-white/5">
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-4 tracking-widest">제출 현황 (Submission)</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[1,2,3,4,5,6,7,8,9].map(tId => {
                          // Fix: Add explicit type casting for p to Player to resolve unknown property errors
                          const quizPlayer = Object.values(gameState.players).find(p => (p as Player).teamId === tId.toString() && (p as Player).role === Role.QUIZ) as Player | undefined;
                          const submitted = quizPlayer?.hasSubmittedQuiz;
                          const active = !!Object.values(gameState.players).find(p => (p as Player).teamId === tId.toString());
                          if (!active) return null;
                          return (
                            <div key={tId} className={`p-2 rounded-lg text-center font-black text-[10px] border ${submitted ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-white/5 text-slate-500'}`}>
                              {tId}팀 {submitted ? '제출' : '대기'}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Team Live Stats</p>
                    {(Object.values(gameState.teams) as Team[]).map(t => (
                      <div key={t.id} className="p-4 bg-black/40 rounded-3xl border border-white/10">
                        <div className="flex justify-between items-center mb-3">
                           <span className="font-black text-sm">{t.name}</span>
                           <div className="flex gap-1">
                              <button onClick={()=>network.sendAction({type:'GIVE_POINT', payload:{teamId:t.id, amount:5}})} className="bg-amber-500 text-black px-2 py-1 rounded-lg text-[10px] font-black">+5P</button>
                           </div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-bold text-slate-400">
                           <div className="flex justify-between"><span>HP</span><span className="text-red-400">{t.hp}</span></div>
                           <div className="flex justify-between"><span>MP</span><span className="text-blue-400">{t.mp}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
             </div>
           )}

           {!isTeacher && myPlayer && (
             <div className="space-y-6">
                {myPlayer.role === Role.QUIZ && (
                  <div className="space-y-6">
                    <h3 className="text-2xl font-black text-violet-300 italic">KNOWLEDGE BRAIN</h3>
                    {gameState.phase === 'QUIZ' ? (
                      gameState.players[myPlayer.id].hasSubmittedQuiz ? (
                        <div className="p-10 bg-black/30 rounded-[3rem] border border-white/5 text-center animate-pulse">
                          <p className="text-4xl mb-4">✅</p>
                          <p className="font-bold text-sm text-slate-400">답안 제출 완료!<br/>전장에 마력이 공급됩니다.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="p-6 bg-slate-900 rounded-[2.5rem] font-bold border-2 border-violet-500 shadow-xl">{currentQuiz.question}</div>
                          {currentQuiz.options.map((opt, i) => (
                            <button key={i} onClick={()=>network.sendAction({type:'QUIZ_ANSWER', payload:{playerId:myPlayer.id, teamId:myPlayer.teamId, correct: i===currentQuiz.answer}})} className="w-full p-5 bg-violet-600 hover:bg-violet-500 rounded-2xl text-left font-black text-sm transition-all transform hover:scale-105 active:scale-95 shadow-lg">
                              <span className="bg-white/20 px-2 py-1 rounded mr-3">{i+1}</span> {opt}
                            </button>
                          ))}
                        </div>
                      )
                    ) : (
                      <div className="p-8 bg-black/40 rounded-[2.5rem] border border-white/5">
                        <p className="text-xs font-black text-slate-500 uppercase mb-4">정답 리뷰 (Last Answer)</p>
                        {prevQuiz ? (
                          <div className="space-y-2">
                            <p className="font-bold text-sm text-white">Q. {prevQuiz.question}</p>
                            <div className="p-3 bg-emerald-600/20 border border-emerald-500/50 rounded-xl">
                              <p className="text-xs font-black text-emerald-400">정답: {prevQuiz.options[prevQuiz.answer]}</p>
                            </div>
                          </div>
                        ) : <p className="text-xs text-slate-500">이전 문제가 없습니다.</p>}
                      </div>
                    )}
                  </div>
                )}

                {myPlayer.role === Role.SUPPORT && team && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center bg-black/30 p-5 rounded-[2rem] border-2 border-emerald-500/30">
                       <h3 className="text-xl font-black text-emerald-400">SUPPORTER</h3>
                       <span className="bg-amber-500 text-black px-4 py-1 rounded-full font-black italic shadow-lg">{team.points} P</span>
                    </div>
                    {gameState.phase === 'BATTLE' ? (
                      <div className="space-y-6">
                         <section className="space-y-3">
                           <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Gear Upgrade (4P)</p>
                           <div className="grid grid-cols-1 gap-2">
                              <button disabled={team.items.weapon} onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'weapon', cost:COSTS.ITEM}})} className="p-4 bg-slate-900 hover:bg-emerald-900/50 disabled:opacity-20 rounded-2xl text-xs font-bold border border-white/5 flex justify-between"><span>⚔️ 전설의 무기 (+ATK)</span><span>4P</span></button>
                              <button disabled={team.items.armor} onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'ITEM', item:'armor', cost:COSTS.ITEM}})} className="p-4 bg-slate-900 hover:bg-emerald-900/50 disabled:opacity-20 rounded-2xl text-xs font-bold border border-white/5 flex justify-between"><span>🛡️ 신성한 갑옷 (+DEF)</span><span>4P</span></button>
                           </div>
                         </section>
                         <section className="space-y-3">
                           <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Skill Unlock (6P)</p>
                           <div className="space-y-2">
                              {SKILLS_INFO[team.classType].map(sk => (
                                <button key={sk.id} disabled={team.unlockedSkills.includes(sk.id)} onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'SKILL', skillId:sk.id, cost:COSTS.SKILL}})} className="w-full p-4 bg-slate-900 hover:bg-blue-900/50 disabled:opacity-20 rounded-2xl text-left border border-white/10 group">
                                  <div className="flex justify-between items-center mb-1"><span className="font-black text-xs text-white group-hover:text-blue-400">{sk.name}</span><span className="text-[10px] font-black bg-white/10 px-2 rounded">6P</span></div>
                                  <p className="text-[10px] text-slate-500 leading-tight">{sk.desc}</p>
                                </button>
                              ))}
                           </div>
                         </section>
                         <section className="space-y-3">
                           <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Direct Buff (3P)</p>
                           <div className="grid grid-cols-2 gap-2">
                              <button onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'hp', cost:COSTS.STAT}})} className="p-3 bg-rose-900/20 hover:bg-rose-900/40 rounded-xl text-[10px] font-black border border-rose-500/20">❤️ HP 회복</button>
                              <button onClick={()=>network.sendAction({type:'SUPPORT_ACTION', payload:{teamId:team.id, action:'STAT', stat:'mp', cost:COSTS.STAT}})} className="p-3 bg-blue-900/20 hover:bg-blue-900/40 rounded-xl text-[10px] font-black border border-blue-500/20">💧 MP 회복</button>
                           </div>
                         </section>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="p-8 bg-black/30 rounded-[3rem] border border-white/5 text-center">
                          <p className="font-bold text-sm text-slate-500">준비 단계입니다.</p>
                        </div>
                        <div className="p-6 bg-black/40 rounded-[2.5rem] border border-white/5">
                          <p className="text-xs font-black text-slate-500 uppercase mb-4">정답 리뷰</p>
                          {prevQuiz ? (
                            <div className="space-y-2">
                              <p className="font-bold text-sm text-white">Q. {prevQuiz.question}</p>
                              <div className="p-3 bg-emerald-600/20 border border-emerald-500/50 rounded-xl">
                                <p className="text-xs font-black text-emerald-400">정답: {prevQuiz.options[prevQuiz.answer]}</p>
                              </div>
                            </div>
                          ) : <p className="text-xs text-slate-500">이전 문제가 없습니다.</p>}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {myPlayer.role === Role.COMBAT && (
                  <div className="space-y-6">
                    <h3 className="text-2xl font-black text-red-500 italic">WARRIOR STATUS</h3>
                    <div className="p-10 bg-black/40 rounded-[3.5rem] text-center border-4 border-white/5 relative shadow-inner">
                       <div className="text-9xl mb-4 animate-bounce">{team?.classType === ClassType.WARRIOR ? '🛡️' : team?.classType === ClassType.MAGE ? '🔮' : team?.classType === ClassType.ARCHER ? '🏹' : '🗡️'}</div>
                       <p className="font-black uppercase tracking-[0.5em] text-blue-400 text-xl">{team?.classType}</p>
                    </div>
                    {gameState.phase === 'QUIZ' && (
                      <div className="p-6 bg-black/40 rounded-[2.5rem] border border-white/5">
                        <p className="text-xs font-black text-slate-500 uppercase mb-4">정답 리뷰</p>
                        {prevQuiz ? (
                          <div className="space-y-2">
                            <p className="font-bold text-sm text-white">Q. {prevQuiz.question}</p>
                            <div className="p-3 bg-emerald-600/20 border border-emerald-500/50 rounded-xl">
                              <p className="text-xs font-black text-emerald-400">정답: {prevQuiz.options[prevQuiz.answer]}</p>
                            </div>
                          </div>
                        ) : <p className="text-xs text-slate-500">이전 문제가 없습니다.</p>}
                      </div>
                    )}
                  </div>
                )}
             </div>
           )}
        </div>
      </div>
    );
  }

  return null;
};

export default App;
