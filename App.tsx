
import React, { useState, useEffect, useRef } from 'react';
import { network } from './services/p2pNetwork';
import { Role, ClassType, Player, Team, GameState, Quiz } from './types';
import { CLASS_CONFIGS } from './constants';
import { GameCanvas } from './components/GameCanvas';
import { Joystick } from './components/Joystick';

const App: React.FC = () => {
  const [view, setView] = useState<'landing' | 'host_setup' | 'host_lobby' | 'lobby' | 'game'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ teamId: string, role: Role, classType?: ClassType } | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const [gameState, setGameState] = useState<GameState>({
    isStarted: false,
    teams: {},
    players: {},
    quizzes: [],
    currentQuizIndex: 0,
    phase: 'QUIZ'
  });

  const [customCode, setCustomCode] = useState('');
  const [quizList, setQuizList] = useState<Quiz[]>([]);
  const [newQuiz, setNewQuiz] = useState<Quiz>({ question: '', options: ['', '', '', ''], answer: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 게임 시작 상태 감시하여 화면 전환
  useEffect(() => {
    if (gameState.isStarted && view !== 'game') {
      setView('game');
    }
  }, [gameState.isStarted, view]);

  useEffect(() => {
    if (isHost) {
      network.setActionListener((action: any) => {
        handleHostAction(action);
      });
    }
  }, [isHost, gameState]);

  const handleHostAction = (action: any) => {
    let newState = { ...gameState };

    switch (action.type) {
      case 'CONFIRM_SELECTION': {
        const { player } = action.payload;
        newState.players = { ...newState.players, [player.id]: player };
        const { teamId, classType } = player;

        if (!newState.teams[teamId]) {
          newState.teams[teamId] = {
            id: teamId,
            name: `${teamId} 모둠`,
            points: 0,
            stats: { ...CLASS_CONFIGS[classType as ClassType] },
            hp: CLASS_CONFIGS[classType as ClassType].hp,
            maxHp: CLASS_CONFIGS[classType as ClassType].hp,
            x: Math.random() * 600 + 200,
            y: Math.random() * 600 + 200,
            isDead: false,
            classType: classType
          };
        }
        break;
      }
      case 'MOVE': {
        const { teamId, dir } = action.payload;
        if (newState.teams[teamId] && !newState.teams[teamId].isDead) {
          newState.teams[teamId].x = Math.max(0, Math.min(1000, newState.teams[teamId].x + dir.x * 25));
          newState.teams[teamId].y = Math.max(0, Math.min(1000, newState.teams[teamId].y + dir.y * 25));
        }
        break;
      }
      case 'ATTACK': {
        const { teamId } = action.payload;
        const attacker = newState.teams[teamId];
        if (!attacker || attacker.isDead) return;
        (Object.values(newState.teams) as Team[]).forEach((target) => {
          if (target.id === teamId || target.isDead) return;
          const d = Math.sqrt(Math.pow(target.x - attacker.x, 2) + Math.pow(target.y - attacker.y, 2));
          if (d < attacker.stats.range) {
            const damage = Math.max(1, attacker.stats.atk - (target.stats.def * 0.5));
            target.hp = Math.max(0, target.hp - damage);
            if (target.hp <= 0) target.isDead = true;
          }
        });
        break;
      }
      case 'QUIZ_ANSWER': {
        const { teamId, correct } = action.payload;
        if (newState.teams[teamId]) {
          newState.teams[teamId].points += correct ? 10 : 2;
          // 퀴즈 하나 풀면 다음 퀴즈 혹은 전투 페이즈 전환 로직 (임시로 전투 전환)
          newState.phase = 'BATTLE'; 
        }
        break;
      }
    }

    setGameState(newState);
    network.broadcastState(newState);
  };

  const createRoom = () => {
    const codeInput = customCode.trim();
    if (!codeInput) return alert("방 코드를 입력해주세요.");
    
    const finalCode = codeInput.toUpperCase();
    setIsConnecting(true);
    
    network.init(
      finalCode, 
      true, 
      (state) => setGameState(state),
      () => {
        setIsHost(true);
        setIsConnecting(false);
        setRoomCode(finalCode);
        const initialState: GameState = { 
          roomCode: finalCode, 
          isStarted: false, 
          players: {}, 
          teams: {}, 
          quizzes: quizList,
          currentQuizIndex: 0,
          phase: 'QUIZ'
        };
        setGameState(initialState);
        network.broadcastState(initialState);
        setView('host_lobby');
      }
    );

    setTimeout(() => {
      if (isConnecting) {
        setIsConnecting(false);
      }
    }, 10000);
  };

  const joinRoom = () => {
    const targetCode = roomCode.trim().toUpperCase();
    if (!targetCode || !userName) return alert("닉네임과 방 코드를 입력하세요.");
    setIsConnecting(true);
    
    network.init(targetCode, false, (state) => {
      if (state && state.roomCode) {
        setGameState(state);
        setIsConnecting(false);
        setView('lobby');
      }
    });

    setTimeout(() => {
      if (isConnecting && view === 'landing') {
        setIsConnecting(false);
        alert("방에 연결할 수 없습니다.");
      }
    }, 8000);
  };

  const confirmSelection = () => {
    if (!pendingSelection || !userName) return;
    const player: Player = { 
      id: userName, name: userName, teamId: pendingSelection.teamId, 
      role: pendingSelection.role, classType: pendingSelection.classType || ClassType.WARRIOR, points: 0 
    };
    setMyPlayer(player);
    network.sendAction({ type: 'CONFIRM_SELECTION', payload: { player } });
    setPendingSelection(null);
  };

  const startBattle = () => {
    const players = Object.values(gameState.players);
    if (players.length === 0) return alert("참여한 인원이 없습니다!");
    
    const ns = { 
      ...gameState, 
      isStarted: true,
      phase: 'QUIZ' // 퀴즈부터 시작하거나 바로 전투하려면 'BATTLE'로 설정
    };
    setGameState(ns);
    network.broadcastState(ns);
  };

  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#020617] text-white">
        <div className="text-center mb-12">
          <h1 className="text-8xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-blue-300 via-white to-blue-600 drop-shadow-2xl animate-pulse">EDU ARENA</h1>
          <p className="text-blue-400 font-bold tracking-[0.5em] mt-4 uppercase">Fantasy Battle Royale</p>
        </div>
        <div className="w-full max-md p-10 bg-slate-900/80 backdrop-blur-xl rounded-[3rem] border-2 border-blue-500/30 shadow-[0_0_50px_rgba(59,130,246,0.2)] space-y-8">
          <div className="space-y-4">
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 font-bold" placeholder="영웅 닉네임" value={userName} onChange={e => setUserName(e.target.value)} />
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 uppercase font-black" placeholder="방 코드" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button onClick={joinRoom} disabled={isConnecting} className={`w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-2xl transition-all ${isConnecting ? 'opacity-50 cursor-wait' : 'active:scale-95'}`}>
              {isConnecting ? '연결 시도 중...' : '입장하기'}
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
               <input className="flex-1 p-4 bg-slate-900 border border-white/10 rounded-2xl text-center text-2xl font-black uppercase outline-none focus:ring-2 ring-blue-500" placeholder="방 코드 설정 (예: KOREA1)" value={customCode} onChange={e => setCustomCode(e.target.value)} />
               <button onClick={createRoom} disabled={isConnecting} className={`px-10 py-6 bg-blue-600 rounded-2xl font-black text-2xl shadow-xl transition-all ${isConnecting ? 'opacity-50 cursor-wait' : 'hover:bg-blue-500 active:scale-95'}`}>
                 {isConnecting ? '서버 등록 중...' : '전장 생성'}
               </button>
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
          <div className="flex flex-col items-end gap-3">
             <p className="text-slate-500 font-bold">접속 중인 영웅: {players.length}명</p>
             <button onClick={startBattle} className="px-16 py-8 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-4xl shadow-2xl transition-all active:scale-95 animate-pulse">전투 개시</button>
          </div>
        </header>
        <div className="flex-1 grid grid-cols-3 gap-8 overflow-y-auto custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            const teamPlayers = players.filter(p => p.teamId === tId.toString());
            return (
              <div key={tId} className={`bg-slate-900/80 p-6 rounded-[2.5rem] border transition-all ${teamPlayers.length > 0 ? 'border-blue-500/50 shadow-xl' : 'border-white/5 opacity-50'}`}>
                <h3 className="text-2xl font-black italic border-b border-white/10 pb-2 mb-4">{tId} 모둠</h3>
                <div className="space-y-2 text-sm text-slate-400">
                  {teamPlayers.length === 0 ? '영웅 대기 중...' : teamPlayers.map(p => (
                    <div key={p.id} className="flex justify-between bg-white/5 p-2 rounded-lg border border-white/5">
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
                    <button disabled={quizTaken || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })} className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'ring-4 ring-white bg-blue-600' : quizTaken ? 'bg-slate-950 opacity-40 grayscale' : 'bg-slate-800 hover:bg-slate-700'}`}>
                      <span>🧠 문제풀이</span><span className="text-xs">{quizTaken ? '점유됨' : '선택'}</span>
                    </button>
                    <button disabled={supporters >= 2 || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })} className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'ring-4 ring-white bg-emerald-600' : supporters >= 2 ? 'bg-slate-950 opacity-40 grayscale' : 'bg-slate-800 hover:bg-slate-700'}`}>
                      <span>🛡️ 서포터 ({supporters}/2)</span><span className="text-xs">{supporters >= 2 ? '점유됨' : '선택'}</span>
                    </button>
                    <div className="pt-4 border-t border-white/10 mt-2">
                       <p className="text-[10px] font-black text-slate-500 uppercase mb-3">Combatant Class</p>
                       <div className="grid grid-cols-2 gap-2">
                          {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => {
                            const isPending = pendingSelection?.teamId === tId.toString() && pendingSelection?.classType === ct;
                            return (
                              <button key={ct} disabled={combatTaken || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })} className={`p-3 rounded-xl text-xs font-black transition-all ${isPending ? 'ring-4 ring-white bg-red-600 shadow-xl' : combatTaken ? 'bg-black opacity-40 grayscale' : 'bg-slate-950 hover:bg-slate-800'}`}>
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
            <button disabled={!pendingSelection} onClick={confirmSelection} className={`w-full max-w-md py-6 rounded-[2.5rem] font-black text-3xl shadow-2xl transition-all ${pendingSelection ? 'bg-blue-600 animate-bounce' : 'bg-slate-800 opacity-50 grayscale cursor-not-allowed'}`}>선택 완료</button>
          </div>
        )}
        {myPlayer && <div className="fixed bottom-12 left-0 right-0 text-center font-black text-blue-400 animate-pulse text-2xl italic">교사가 전투를 시작하길 기다리는 중...</div>}
      </div>
    );
  }

  if (view === 'game') {
    const isTeacher = isHost;
    const team = myPlayer ? gameState.teams[myPlayer.teamId] : null;
    const phase = gameState.phase || 'QUIZ';
    const currentQuiz = gameState.quizzes[gameState.currentQuizIndex] || { question: '등록된 퀴즈가 없습니다.', options: ['대기'], answer: 0 };

    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col md:flex-row overflow-hidden select-none">
        <div className="flex-1 relative order-1 md:order-none">
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer?.teamId} />
          
          {/* 상단 상태 바 */}
          <div className="absolute top-8 left-8 right-8 flex justify-between pointer-events-none">
            {team && (
              <div className="bg-slate-900/90 p-6 rounded-[2rem] border-2 border-white/10 pointer-events-auto shadow-2xl backdrop-blur-md flex items-center gap-6">
                <div className="text-center">
                   <p className="text-xs text-blue-400 font-black uppercase mb-1">{team.name}</p>
                   <h4 className="text-2xl font-black italic">{team.hp > 0 ? 'ACTIVE' : 'DOWN'}</h4>
                </div>
                <div className="w-32 h-3 bg-black rounded-full border border-white/10 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-red-600 to-pink-600 transition-all duration-500" style={{ width: `${(team.hp/team.maxHp)*100}%` }} />
                </div>
                <div className="bg-amber-500 px-6 py-3 rounded-xl text-black font-black text-xl italic shadow-2xl">{team.points} P</div>
              </div>
            )}
            {isTeacher && (
              <div className="bg-slate-900/90 p-6 rounded-[2rem] border-2 border-blue-500/50 pointer-events-auto shadow-2xl backdrop-blur-md flex items-center gap-4">
                <span className="font-black text-blue-400 uppercase">전장 중계 모드</span>
                <button onClick={() => {
                  const ns = {...gameState, phase: gameState.phase === 'QUIZ' ? 'BATTLE' : 'QUIZ'};
                  setGameState(ns);
                  network.broadcastState(ns);
                }} className="bg-blue-600 px-4 py-2 rounded-lg font-bold text-xs">페이즈 강제 전환</button>
              </div>
            )}
          </div>

          {/* 전투 조작 (학생 전투원 전용) */}
          {myPlayer?.role === Role.COMBAT && phase === 'BATTLE' && team && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-125 origin-bottom-left pointer-events-auto">
                <Joystick onMove={(dir) => network.sendAction({ type: 'MOVE', payload: { teamId: myPlayer.teamId, dir } })} />
              </div>
              <div className="absolute bottom-12 right-12 pointer-events-auto">
                <button onClick={() => network.sendAction({ type: 'ATTACK', payload: { teamId: myPlayer.teamId } })} className="w-28 h-28 bg-red-600 rounded-full shadow-2xl border-4 border-white/20 active:scale-90 font-black text-4xl flex items-center justify-center">⚔️</button>
              </div>
            </>
          )}
        </div>

        {/* 사이드바 (학생용 역할별 인터페이스) */}
        {!isTeacher && myPlayer && (
          <div className="w-full md:w-80 bg-slate-900/95 border-l-2 border-white/5 p-8 flex flex-col gap-6 order-2 md:order-none shadow-2xl backdrop-blur-2xl">
             <header>
               <p className="text-[10px] text-blue-500 font-black tracking-widest uppercase mb-1">{myPlayer.role}</p>
               <h3 className="text-3xl font-black italic tracking-tighter">{team?.name}</h3>
             </header>
             <div className="flex-1 overflow-y-auto custom-scrollbar">
               {myPlayer.role === Role.QUIZ && phase === 'QUIZ' && (
                 <div className="space-y-6">
                   <div className="p-4 bg-blue-600/10 border border-blue-500/20 rounded-xl">
                    <h4 className="text-lg font-bold leading-snug">Q. {currentQuiz.question}</h4>
                   </div>
                   <div className="space-y-3">
                      {currentQuiz.options.map((opt, i) => opt && (
                        <button key={i} onClick={() => network.sendAction({ type: 'QUIZ_ANSWER', payload: { teamId: myPlayer.teamId, correct: i === currentQuiz.answer } })} className="w-full p-4 bg-slate-800 hover:bg-blue-600 rounded-xl text-left font-black transition-all border border-white/5 text-sm">{i+1}. {opt}</button>
                      ))}
                   </div>
                 </div>
               )}
               {myPlayer.role === Role.SUPPORT && (
                 <div className="space-y-3">
                   <p className="text-[10px] font-black text-slate-500 uppercase">지원 스킬</p>
                   <button className="w-full p-4 bg-red-900/20 border border-red-500/20 rounded-xl flex justify-between items-center hover:bg-red-600 transition-all text-sm"><span className="text-xl">⚔️</span><div className="font-black">공격력 강화</div><span className="font-bold">10P</span></button>
                   <button className="w-full p-4 bg-emerald-900/20 border border-emerald-500/20 rounded-xl flex justify-between items-center hover:bg-emerald-600 transition-all text-sm"><span className="text-xl">❤️</span><div className="font-black">생명력 회복</div><span className="font-bold">10P</span></button>
                 </div>
               )}
               {myPlayer.role === Role.COMBAT && (
                 <div className="text-center p-8 bg-white/5 rounded-3xl border border-white/5 space-y-4">
                   <div className="text-7xl">{team?.classType === ClassType.WARRIOR ? '🛡️' : team?.classType === ClassType.MAGE ? '🔮' : team?.classType === ClassType.ARCHER ? '🏹' : '🗡️'}</div>
                   <h4 className="text-xl font-black italic uppercase">{team?.classType}</h4>
                   <p className="text-[10px] text-slate-500">전장 중앙의 원을 확인하세요!</p>
                 </div>
               )}
               {phase === 'BATTLE' && myPlayer.role === Role.QUIZ && (
                 <div className="p-8 text-center bg-amber-500/10 border border-amber-500/20 rounded-2xl animate-pulse">
                   <p className="font-black text-amber-500 uppercase">전투 진행 중!</p>
                   <p className="text-xs text-slate-400 mt-2">전투원이 싸우는 동안 잠시 대기하세요.</p>
                 </div>
               )}
             </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default App;
