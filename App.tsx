
import React, { useState, useEffect, useRef } from 'react';
import { socket } from './services/mockSocket';
import { Role, ClassType, Player, Team, GameState, Quiz } from './types';
import { CLASS_CONFIGS, UPGRADE_COSTS } from './constants';
import { GameCanvas } from './components/GameCanvas';
import { Joystick } from './components/Joystick';

const App: React.FC = () => {
  const [view, setView] = useState<'landing' | 'host_setup' | 'host_lobby' | 'lobby' | 'game'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ teamId: string, role: Role, classType?: ClassType } | null>(null);
  
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

  useEffect(() => {
    const unsub = socket.subscribe('stateChange', (state: any) => {
      setGameState(state);
      if (state.isStarted && view === 'lobby') setView('game');
    });
    return unsub;
  }, [view]);

  const createRoom = () => {
    const finalCode = customCode.trim().toUpperCase() || Math.random().toString(36).substring(2, 7).toUpperCase();
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
    socket.emit('stateChange', initialState);
    setView('host_lobby');
  };

  const confirmSelection = () => {
    if (!pendingSelection || !userName) return;
    const { teamId, role, classType } = pendingSelection;

    const playerId = userName;
    const newPlayer: Player = { id: playerId, name: userName, teamId, role, classType: classType || ClassType.WARRIOR, points: 0 };
    
    const updatedPlayers = { ...gameState.players, [playerId]: newPlayer };
    const updatedTeams = { ...gameState.teams };
    
    if (!updatedTeams[teamId]) {
      updatedTeams[teamId] = {
        id: teamId,
        name: `${teamId} 모둠`,
        points: 0,
        stats: { ...CLASS_CONFIGS[classType || ClassType.WARRIOR] },
        hp: CLASS_CONFIGS[classType || ClassType.WARRIOR].hp,
        maxHp: CLASS_CONFIGS[classType || ClassType.WARRIOR].hp,
        x: Math.random() * 600 + 200,
        y: Math.random() * 600 + 200,
        isDead: false,
        classType: classType || ClassType.WARRIOR
      };
    }

    if (role === Role.COMBAT && classType) {
      updatedTeams[teamId].classType = classType;
      updatedTeams[teamId].stats = { ...CLASS_CONFIGS[classType] };
      updatedTeams[teamId].hp = CLASS_CONFIGS[classType].hp;
      updatedTeams[teamId].maxHp = CLASS_CONFIGS[classType].hp;
    }

    setMyPlayer(newPlayer);
    socket.emit('stateChange', { players: updatedPlayers, teams: updatedTeams });
    setPendingSelection(null);
  };

  const handleQuizAnswer = (correct: boolean) => {
    if (!myPlayer) return;
    const pointsToAdd = correct ? 6 : 4;
    const updatedTeams = { ...gameState.teams };
    updatedTeams[myPlayer.teamId].points += pointsToAdd;
    socket.emit('stateChange', { teams: updatedTeams, phase: 'BATTLE' });
  };

  const movePlayer = (dir: { x: number; y: number }) => {
    if (!myPlayer || myPlayer.role !== Role.COMBAT || gameState.phase !== 'BATTLE') return;
    const team = gameState.teams[myPlayer.teamId];
    if (!team || team.isDead) return;
    const updatedTeams = { ...gameState.teams };
    updatedTeams[myPlayer.teamId].x = Math.max(0, Math.min(1000, team.x + dir.x * 25));
    updatedTeams[myPlayer.teamId].y = Math.max(0, Math.min(1000, team.y + dir.y * 25));
    socket.emit('stateChange', { teams: updatedTeams });
  };

  const attack = () => {
    if (!myPlayer || myPlayer.role !== Role.COMBAT || gameState.phase !== 'BATTLE') return;
    const myTeam = gameState.teams[myPlayer.teamId];
    if (!myTeam || myTeam.isDead) return;
    const updatedTeams = { ...gameState.teams };
    Object.values(updatedTeams).forEach(target => {
      if (target.id === myPlayer.teamId || target.isDead) return;
      const d = Math.sqrt(Math.pow(target.x - myTeam.x, 2) + Math.pow(target.y - myTeam.y, 2));
      if (d < myTeam.stats.range) {
        const damage = Math.max(1, myTeam.stats.atk - (target.stats.def * 0.5));
        target.hp = Math.max(0, target.hp - damage);
        if (target.hp <= 0) target.isDead = true;
      }
    });
    socket.emit('stateChange', { teams: updatedTeams });
  };

  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#020617] text-white">
        <h1 className="text-7xl font-black italic mb-8 bg-clip-text text-transparent bg-gradient-to-b from-blue-300 to-blue-600">EDU ARENA</h1>
        <div className="w-full max-w-md p-8 bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl space-y-6">
          <input className="w-full p-4 bg-slate-800 rounded-2xl text-white font-bold" placeholder="닉네임" value={userName} onChange={e => setUserName(e.target.value)} />
          <input className="w-full p-4 bg-slate-800 rounded-2xl text-white font-black uppercase" placeholder="방 코드" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
          <button onClick={() => roomCode ? setView('lobby') : alert("방 코드를 입력하세요")} className="w-full py-4 bg-blue-600 rounded-2xl font-black text-xl active:scale-95 transition-all">전장 입장</button>
          <button onClick={() => setView('host_setup')} className="w-full py-3 bg-slate-800 rounded-2xl font-bold text-slate-500">교사 메뉴</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="h-screen bg-[#020617] text-white p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-8 border-b border-white/5 pb-4">
          <h2 className="text-3xl font-black italic text-blue-400">전장 설계</h2>
          <button onClick={() => setView('landing')} className="text-slate-500">뒤로</button>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-slate-900 p-6 rounded-3xl space-y-4">
            <h3 className="font-black">퀴즈 추가</h3>
            <input className="w-full p-3 bg-black/50 rounded-xl" placeholder="질문" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
            <button onClick={() => { if(newQuiz.question) setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); }} className="w-full py-3 bg-blue-600 rounded-xl font-black">추가</button>
          </div>
          <div className="bg-slate-900 p-6 rounded-3xl flex flex-col gap-4">
            <input className="p-4 bg-black rounded-xl text-center text-2xl font-black uppercase" placeholder="방 코드 지정" value={customCode} onChange={e => setCustomCode(e.target.value)} />
            <button onClick={createRoom} className="py-4 bg-emerald-600 rounded-xl font-black text-2xl">방 생성</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'host_lobby') {
    const players = Object.values(gameState.players);
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-8">
        <header className="flex justify-between items-center mb-8 bg-slate-900 p-6 rounded-3xl border border-white/10">
          <div>
            <p className="text-xs text-blue-500 font-bold tracking-widest">ROOM CODE</p>
            <h2 className="text-6xl font-mono font-black">{gameState.roomCode}</h2>
          </div>
          <button onClick={() => socket.emit('stateChange', { isStarted: true })} className="px-12 py-6 bg-blue-600 rounded-2xl font-black text-3xl">게임 시작</button>
        </header>
        <div className="flex-1 bg-slate-900/50 rounded-3xl p-6 overflow-y-auto custom-scrollbar">
          <h3 className="text-xl font-black mb-4">참가자 현황 ({players.length})</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {players.map(p => (
              <div key={p.id} className="p-4 bg-white/5 border border-white/5 rounded-2xl text-center">
                <div className="text-3xl mb-1">{p.role === Role.COMBAT ? '⚔️' : p.role === Role.QUIZ ? '🧠' : '🛡️'}</div>
                <div className="font-black truncate">{p.name}</div>
                <div className="text-[10px] text-blue-400 font-bold">{p.teamId}모둠</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'lobby') {
    const players = Object.values(gameState.players);
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-4 md:p-8 overflow-hidden">
        <h2 className="text-4xl md:text-5xl font-black italic text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-white">모둠 및 역할 선택</h2>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pb-24">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tId => {
              const teamPlayers = players.filter(p => p.teamId === tId.toString());
              const quizTaken = teamPlayers.some(p => p.role === Role.QUIZ);
              const combatTaken = teamPlayers.some(p => p.role === Role.COMBAT);
              const supporters = teamPlayers.filter(p => p.role === Role.SUPPORT).length;
              
              const isSelected = myPlayer?.teamId === tId.toString();

              return (
                <div key={tId} className={`p-6 rounded-[2.5rem] border-2 transition-all ${isSelected ? 'bg-blue-600/20 border-blue-500' : 'bg-slate-900 border-white/5'}`}>
                  <h3 className="text-2xl font-black mb-4 italic">{tId} Team</h3>
                  <div className="space-y-2">
                    {/* 문제풀이 */}
                    <button 
                      disabled={quizTaken || !!myPlayer}
                      onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })}
                      className={`w-full p-3 rounded-xl text-left font-bold flex justify-between ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'ring-2 ring-white bg-blue-600' : 'bg-slate-800'}`}
                    >
                      <span>🧠 문제풀이</span>
                      <span className="text-[10px] opacity-60">{quizTaken ? '선택 완료' : '가능'}</span>
                    </button>
                    
                    {/* 서포터 */}
                    <button 
                      disabled={supporters >= 2 || !!myPlayer}
                      onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })}
                      className={`w-full p-3 rounded-xl text-left font-bold flex justify-between ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'ring-2 ring-white bg-emerald-600' : 'bg-slate-800'}`}
                    >
                      <span>🛡️ 서포터 ({supporters}/2)</span>
                      <span className="text-[10px] opacity-60">{supporters >= 2 ? '선택 완료' : '가능'}</span>
                    </button>

                    {/* 전투요원 */}
                    <div className="pt-2 border-t border-white/5 mt-2">
                      <p className="text-[9px] font-black text-slate-500 uppercase mb-2">전투요원 & 직업</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => {
                          const isPending = pendingSelection?.teamId === tId.toString() && pendingSelection?.classType === ct;
                          return (
                            <button 
                              key={ct}
                              disabled={combatTaken || !!myPlayer}
                              onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })}
                              className={`p-2 rounded-xl text-[10px] font-black transition-all ${isPending ? 'ring-2 ring-white bg-red-600' : 'bg-slate-950'}`}
                            >
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

        {/* 확정 버튼 하단 고정 */}
        {!myPlayer && (
          <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black to-transparent flex justify-center">
            <button 
              disabled={!pendingSelection}
              onClick={confirmSelection}
              className={`w-full max-w-md py-5 rounded-3xl font-black text-2xl shadow-2xl transition-all ${pendingSelection ? 'bg-blue-600 animate-bounce' : 'bg-slate-800 opacity-50 grayscale'}`}
            >
              역할 선택 완료
            </button>
          </div>
        )}
        {myPlayer && <div className="fixed bottom-10 left-0 right-0 text-center font-black text-blue-400 animate-pulse">선택이 완료되었습니다. 대기 중...</div>}
      </div>
    );
  }

  if (view === 'game' && myPlayer) {
    const team = gameState.teams[myPlayer.teamId];
    if (!team) return <div className="h-screen bg-black flex items-center justify-center font-black">동기화 중...</div>;
    const currentQuizIdx = gameState.currentQuizIndex || 0;
    const currentQuiz = gameState.quizzes[currentQuizIdx] || { question: "모든 시련을 극복했습니다.", options: ["교사를 기다리세요", "", "", ""], answer: 0 };
    const phase = gameState.phase || 'QUIZ';

    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col md:flex-row overflow-hidden select-none">
        <div className="flex-1 relative order-1 md:order-none">
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer.teamId} />
          <div className="absolute top-4 left-4 right-4 flex justify-between pointer-events-none items-start">
            <div className="bg-slate-900/90 p-4 rounded-3xl border border-white/10 pointer-events-auto flex items-center gap-4">
              <div className="text-xs font-black">HP {Math.ceil(team.hp)}</div>
              <div className="w-24 h-2 bg-black rounded-full overflow-hidden">
                <div className="h-full bg-red-600 transition-all" style={{ width: `${(team.hp/team.maxHp)*100}%` }} />
              </div>
            </div>
            <div className="bg-amber-500 px-6 py-3 rounded-2xl text-black font-black text-2xl italic pointer-events-auto">{team.points} P</div>
          </div>
          {myPlayer.role === Role.COMBAT && phase === 'BATTLE' && !team.isDead && (
            <>
              <div className="absolute bottom-8 left-8 scale-110 origin-bottom-left"><Joystick onMove={movePlayer} /></div>
              <div className="absolute bottom-10 right-10">
                <button onClick={attack} className="w-24 h-24 bg-red-600 rounded-full shadow-2xl border-4 border-white/20 active:scale-90 font-black text-3xl">⚔️</button>
              </div>
            </>
          )}
          {phase === 'QUIZ' && <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-none text-4xl font-black italic text-amber-500">QUIZ PHASE</div>}
        </div>
        <div className="w-full md:w-96 bg-slate-900 border-l border-white/10 p-6 flex flex-col gap-6 order-2 md:order-none">
           <header><p className="text-[10px] text-blue-500 font-bold uppercase">{myPlayer.role}</p><h3 className="text-2xl font-black italic">{team.name}</h3></header>
           <div className="flex-1 overflow-y-auto custom-scrollbar">
             {myPlayer.role === Role.QUIZ && phase === 'QUIZ' && (
                <div className="p-6 bg-slate-800 rounded-3xl space-y-4">
                  <h4 className="font-bold">Q. {currentQuiz.question}</h4>
                  <div className="space-y-2">
                    {currentQuiz.options.map((opt, i) => opt && (
                      <button key={i} onClick={() => handleQuizAnswer(i === currentQuiz.answer)} className="w-full p-4 bg-slate-700 hover:bg-blue-600 rounded-xl text-left font-bold transition-all">{i+1}. {opt}</button>
                    ))}
                  </div>
                </div>
             )}
             {myPlayer.role === Role.SUPPORT && (
               <div className="space-y-3">
                  <button onClick={() => { if(team.points >= 10) { const ut = { ...gameState.teams }; ut[myPlayer.teamId].stats.atk += 10; ut[myPlayer.teamId].points -= 10; socket.emit('stateChange', { teams: ut }); } }} className="w-full p-4 bg-red-900/20 border border-red-500/20 rounded-2xl flex justify-between items-center font-black"><span>⚔️ ATK BOOST</span><span>10P</span></button>
                  <button onClick={() => { if(team.points >= 10) { const ut = { ...gameState.teams }; ut[myPlayer.teamId].hp = Math.min(team.maxHp, team.hp + 50); ut[myPlayer.teamId].points -= 10; socket.emit('stateChange', { teams: ut }); } }} className="w-full p-4 bg-emerald-900/20 border border-emerald-500/20 rounded-2xl flex justify-between items-center font-black"><span>❤️ HEAL</span><span>10P</span></button>
               </div>
             )}
             {myPlayer.role === Role.COMBAT && <div className="text-center p-8 bg-slate-800 rounded-3xl"><div className="text-6xl mb-4">{team.classType === ClassType.WARRIOR ? '🛡️' : team.classType === ClassType.MAGE ? '🔮' : team.classType === ClassType.ARCHER ? '🏹' : '🗡️'}</div><div className="font-black text-2xl italic">{team.classType}</div></div>}
           </div>
        </div>
      </div>
    );
  }

  return null;
};

export default App;
