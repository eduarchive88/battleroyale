
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

  // P2P 상태 수신 리스너
  useEffect(() => {
    if (isHost) {
        network.setActionListener((action: any) => {
            handleHostAction(action);
        });
    }
  }, [isHost, gameState]);

  // 호스트 전용: 액션 처리 로직 (이곳이 진정한 Authority)
  const handleHostAction = (action: any) => {
    if (action.type === 'CONFIRM_SELECTION') {
        const { player } = action.payload;
        const updatedPlayers = { ...gameState.players, [player.id]: player };
        const updatedTeams = { ...gameState.teams };
        const { teamId, classType } = player;

        if (!updatedTeams[teamId]) {
            updatedTeams[teamId] = {
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
        const newState = { ...gameState, players: updatedPlayers, teams: updatedTeams };
        setGameState(newState);
        network.broadcastState(newState);
    }

    if (action.type === 'MOVE') {
        const { teamId, dir } = action.payload;
        const updatedTeams = { ...gameState.teams };
        if (updatedTeams[teamId]) {
            updatedTeams[teamId].x = Math.max(0, Math.min(1000, updatedTeams[teamId].x + dir.x * 25));
            updatedTeams[teamId].y = Math.max(0, Math.min(1000, updatedTeams[teamId].y + dir.y * 25));
            const newState = { ...gameState, teams: updatedTeams };
            setGameState(newState);
            network.broadcastState(newState);
        }
    }

    if (action.type === 'ATTACK') {
        const { teamId } = action.payload;
        const myTeam = gameState.teams[teamId];
        if (!myTeam || myTeam.isDead) return;
        const updatedTeams = { ...gameState.teams };
        Object.values(updatedTeams).forEach((target: any) => {
            if (target.id === teamId || target.isDead) return;
            const d = Math.sqrt(Math.pow(target.x - myTeam.x, 2) + Math.pow(target.y - myTeam.y, 2));
            if (d < myTeam.stats.range) {
                const damage = Math.max(1, myTeam.stats.atk - (target.stats.def * 0.5));
                target.hp = Math.max(0, target.hp - damage);
                if (target.hp <= 0) target.isDead = true;
            }
        });
        const newState = { ...gameState, teams: updatedTeams };
        setGameState(newState);
        network.broadcastState(newState);
    }
  };

  const createRoom = () => {
    const finalCode = customCode.trim().toUpperCase() || Math.random().toString(36).substring(2, 7).toUpperCase();
    setRoomCode(finalCode);
    setIsHost(true);
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
    network.init(finalCode, true, (state) => setGameState(state));
    setView('host_lobby');
  };

  const joinRoom = () => {
      if (!roomCode || !userName) return alert("닉네임과 방 코드를 입력하세요.");
      setIsHost(false);
      network.init(roomCode, false, (state) => {
          setGameState(state);
          if (state.isStarted) setView('game');
      });
      setView('lobby');
  };

  const confirmSelection = () => {
    if (!pendingSelection || !userName) return;
    const { teamId, role, classType } = pendingSelection;
    const newPlayer: Player = { 
        id: userName, 
        name: userName, 
        teamId, 
        role, 
        classType: classType || ClassType.WARRIOR, 
        points: 0 
    };
    setMyPlayer(newPlayer);
    network.sendAction({ type: 'CONFIRM_SELECTION', payload: { player: newPlayer } });
    setPendingSelection(null);
  };

  const startGame = () => {
      const newState = { ...gameState, isStarted: true };
      setGameState(newState);
      network.broadcastState(newState);
  };

  const movePlayer = (dir: { x: number; y: number }) => {
    if (!myPlayer || myPlayer.role !== Role.COMBAT || gameState.phase !== 'BATTLE') return;
    network.sendAction({ type: 'MOVE', payload: { teamId: myPlayer.teamId, dir } });
  };

  const attack = () => {
    if (!myPlayer || myPlayer.role !== Role.COMBAT || gameState.phase !== 'BATTLE') return;
    network.sendAction({ type: 'ATTACK', payload: { teamId: myPlayer.teamId } });
  };

  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#020617] text-white">
        <h1 className="text-8xl font-black italic mb-12 bg-clip-text text-transparent bg-gradient-to-b from-blue-300 to-blue-600 drop-shadow-2xl">EDU ARENA</h1>
        <div className="w-full max-w-md p-10 bg-slate-900 border-2 border-blue-500/20 rounded-[3rem] shadow-2xl space-y-6">
          <input className="w-full p-5 bg-slate-800 rounded-2xl text-white font-bold" placeholder="영웅 이름" value={userName} onChange={e => setUserName(e.target.value)} />
          <input className="w-full p-5 bg-slate-800 rounded-2xl text-white font-black uppercase" placeholder="방 코드" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
          <button onClick={joinRoom} className="w-full py-5 bg-blue-600 rounded-2xl font-black text-2xl active:scale-95 transition-all shadow-lg">전장 입장</button>
          <button onClick={() => setView('host_setup')} className="w-full py-4 bg-slate-800/50 rounded-2xl font-bold text-slate-500 hover:text-white transition-colors">교사 메뉴 (Host)</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="h-screen bg-[#020617] text-white p-10 overflow-y-auto">
        <h2 className="text-4xl font-black italic text-blue-400 mb-10">라운드 설계</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="bg-slate-900 p-8 rounded-[3rem] space-y-4 shadow-xl border border-white/5">
            <h3 className="text-xl font-black">퀴즈 설정</h3>
            <input className="w-full p-4 bg-black/50 rounded-xl" placeholder="질문" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
            <button onClick={() => { if(newQuiz.question) setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); }} className="w-full py-4 bg-blue-600 rounded-xl font-black">퀴즈 리스트에 추가</button>
          </div>
          <div className="bg-slate-900 p-8 rounded-[3rem] space-y-4 shadow-xl border border-white/5">
            <h3 className="text-xl font-black">방 생성</h3>
            <input className="w-full p-4 bg-black rounded-xl text-center text-3xl font-black uppercase" placeholder="방 코드 직접 지정" value={customCode} onChange={e => setCustomCode(e.target.value)} />
            <button onClick={createRoom} className="w-full py-6 bg-emerald-600 rounded-2xl font-black text-3xl shadow-xl transition-all">방 만들기 (Host Start)</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'host_lobby') {
    const players = Object.values(gameState.players) as Player[];
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-10">
        <header className="flex justify-between items-center mb-10 bg-slate-900/80 p-10 rounded-[3rem] border border-blue-500/30">
          <div>
            <p className="text-blue-500 font-black text-sm uppercase tracking-widest mb-2">Battle Room Code</p>
            <h2 className="text-8xl font-mono font-black">{gameState.roomCode}</h2>
          </div>
          <div className="text-right">
              <p className="text-slate-500 font-bold mb-4">현재 참여 인원: {players.length}명</p>
              <button onClick={startGame} className="px-20 py-8 bg-blue-600 hover:bg-blue-500 rounded-3xl font-black text-5xl shadow-2xl transition-all active:scale-95 animate-pulse">전쟁 시작</button>
          </div>
        </header>
        
        <div className="flex-1 grid grid-cols-3 gap-8 overflow-y-auto custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            // Fix: cast to Player[] to avoid 'unknown' errors
            const teamPlayers = players.filter(p => p.teamId === tId.toString());
            const qUser = teamPlayers.find(p => p.role === Role.QUIZ);
            const sUsers = teamPlayers.filter(p => p.role === Role.SUPPORT);
            const cUser = teamPlayers.find(p => p.role === Role.COMBAT);
            return (
              <div key={tId} className={`p-8 rounded-[3rem] border-2 transition-all ${teamPlayers.length > 0 ? 'bg-blue-600/10 border-blue-500/50 shadow-xl' : 'bg-slate-900 border-white/5 opacity-50'}`}>
                <h3 className="text-2xl font-black mb-6 italic">{tId} Team</h3>
                <div className="space-y-3">
                  <div className={`p-3 rounded-xl flex justify-between font-bold text-sm ${qUser ? 'bg-blue-600 text-white' : 'bg-black/20 text-slate-600'}`}><span>🧠 {qUser?.name || '문제풀이'}</span><span>{qUser ? 'OK' : 'WAIT'}</span></div>
                  <div className={`p-3 rounded-xl flex justify-between font-bold text-sm ${sUsers.length > 0 ? 'bg-emerald-600 text-white' : 'bg-black/20 text-slate-600'}`}><span>🛡️ {sUsers.map(s => s.name).join(', ') || '서포터'}</span><span>{sUsers.length}/2</span></div>
                  <div className={`p-3 rounded-xl flex justify-between font-bold text-sm ${cUser ? 'bg-red-600 text-white' : 'bg-black/20 text-slate-600'}`}><span>⚔️ {cUser ? `${cUser.name}(${cUser.classType})` : '전투요원'}</span><span>{cUser ? 'OK' : 'WAIT'}</span></div>
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
      <div className="h-screen bg-[#020617] text-white flex flex-col p-6">
        <h2 className="text-5xl font-black italic text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-white">모둠 역할 배정</h2>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pb-32">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tId => {
              // Fix: cast to Player[] to avoid 'unknown' errors
              const teamPlayers = players.filter(p => p.teamId === tId.toString());
              const quizTaken = teamPlayers.some(p => p.role === Role.QUIZ);
              const combatTaken = teamPlayers.some(p => p.role === Role.COMBAT);
              const supporters = teamPlayers.filter(p => p.role === Role.SUPPORT).length;
              const isMyTeam = myPlayer?.teamId === tId.toString();

              return (
                <div key={tId} className={`p-8 rounded-[3.5rem] border-2 transition-all ${isMyTeam ? 'bg-blue-600/20 border-blue-500 shadow-2xl scale-105 z-10' : 'bg-slate-900 border-white/5'}`}>
                  <h3 className="text-3xl font-black mb-6 italic">{tId} Team</h3>
                  <div className="space-y-3">
                    <button disabled={quizTaken || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })} className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'ring-4 ring-white bg-blue-600' : quizTaken ? 'bg-slate-950 opacity-40 grayscale' : 'bg-slate-800 hover:bg-slate-700'}`}>
                      <span>🧠 문제풀이</span><span className="text-xs">{quizTaken ? '점유됨' : '선택'}</span>
                    </button>
                    <button disabled={supporters >= 2 || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })} className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'ring-4 ring-white bg-emerald-600' : supporters >= 2 ? 'bg-slate-950 opacity-40 grayscale' : 'bg-slate-800 hover:bg-slate-700'}`}>
                      <span>🛡️ 서포터 ({supporters}/2)</span><span className="text-xs">{supporters >= 2 ? '점유됨' : '선택'}</span>
                    </button>
                    <div className="pt-4 border-t border-white/10 mt-2">
                       <p className="text-[10px] font-black text-slate-500 uppercase mb-3">전투원 클래스 선택</p>
                       <div className="grid grid-cols-2 gap-2">
                          {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => {
                            const isPending = pendingSelection?.teamId === tId.toString() && pendingSelection?.classType === ct;
                            return (
                              <button key={ct} disabled={combatTaken || !!myPlayer} onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })} className={`p-3 rounded-xl text-xs font-black transition-all ${isPending ? 'ring-4 ring-white bg-red-600 shadow-xl' : combatTaken ? 'bg-black opacity-40 grayscale' : 'bg-slate-950 hover:bg-slate-800'}`}>
                                {ct === ClassType.WARRIOR ? '🛡️ 전사' : ct === ClassType.MAGE ? '🔮 마술사' : ct === ClassType.ARCHER ? '🏹 궁수' : '🗡️ 도적'}
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
            <button disabled={!pendingSelection} onClick={confirmSelection} className={`w-full max-w-md py-6 rounded-[2.5rem] font-black text-3xl shadow-2xl transition-all ${pendingSelection ? 'bg-blue-600 animate-bounce' : 'bg-slate-800 opacity-50 grayscale cursor-not-allowed'}`}>선택 확정하기</button>
          </div>
        )}
        {myPlayer && <div className="fixed bottom-12 left-0 right-0 text-center font-black text-blue-400 animate-pulse text-2xl italic drop-shadow-lg">용사여, 전장이 열리기를 기다리십시오...</div>}
      </div>
    );
  }

  if (view === 'game' && myPlayer) {
    const team = gameState.teams[myPlayer.teamId];
    if (!team) return <div className="h-screen bg-black flex items-center justify-center font-black text-4xl italic animate-pulse">WARP CORE STABILIZING...</div>;
    const phase = gameState.phase || 'QUIZ';

    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col md:flex-row overflow-hidden select-none">
        <div className="flex-1 relative order-1 md:order-none">
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer.teamId} />
          
          <div className="absolute top-8 left-8 flex gap-6 pointer-events-none">
            <div className="bg-slate-900/90 p-8 rounded-[2.5rem] border-2 border-white/10 pointer-events-auto shadow-2xl backdrop-blur-md">
              <div className="flex items-center gap-6">
                <div className="text-center">
                   <p className="text-xs text-blue-400 font-black uppercase mb-1 tracking-tighter">{team.name}</p>
                   <h4 className="text-3xl font-black italic">{team.hp > 0 ? 'ACTIVE' : 'DESTROYED'}</h4>
                </div>
                <div className="w-48 h-4 bg-black rounded-full border border-white/10 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-red-600 to-pink-600 transition-all duration-500 shadow-[0_0_15px_rgba(220,38,38,0.5)]" style={{ width: `${(team.hp/team.maxHp)*100}%` }} />
                </div>
              </div>
            </div>
            <div className="bg-amber-500 px-10 py-6 rounded-[2.5rem] text-black font-black text-4xl italic pointer-events-auto shadow-[0_0_40px_rgba(245,158,11,0.4)]">{team.points} P</div>
          </div>

          {myPlayer.role === Role.COMBAT && phase === 'BATTLE' && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-150 origin-bottom-left"><Joystick onMove={movePlayer} /></div>
              <div className="absolute bottom-20 right-20">
                <button onClick={attack} className="w-36 h-36 bg-red-600 rounded-full shadow-[0_0_60px_rgba(220,38,38,0.6)] border-8 border-white/20 active:scale-90 font-black text-6xl flex items-center justify-center">⚔️</button>
              </div>
            </>
          )}
          
          {phase === 'QUIZ' && <div className="absolute inset-0 bg-black/60 backdrop-blur-xl flex items-center justify-center pointer-events-none text-7xl font-black italic text-amber-500 animate-pulse tracking-[0.2em] drop-shadow-2xl">QUIZ PHASE</div>}
        </div>

        <div className="w-full md:w-96 bg-slate-900/95 border-l-4 border-blue-500/20 p-10 flex flex-col gap-10 order-2 md:order-none shadow-2xl backdrop-blur-2xl">
           <header><p className="text-sm text-blue-500 font-black tracking-widest uppercase mb-1">{myPlayer.role}</p><h3 className="text-5xl font-black italic tracking-tighter">{team.name}</h3></header>
           <div className="flex-1 overflow-y-auto custom-scrollbar">
             {myPlayer.role === Role.COMBAT && (
               <div className="text-center p-12 bg-white/5 rounded-[3.5rem] border border-white/5 space-y-8 shadow-inner">
                 <div className="text-9xl drop-shadow-2xl transform hover:scale-110 transition-transform">{team.classType === ClassType.WARRIOR ? '🛡️' : team.classType === ClassType.MAGE ? '🔮' : team.classType === ClassType.ARCHER ? '🏹' : '🗡️'}</div>
                 <h4 className="text-4xl font-black italic uppercase tracking-widest">{team.classType}</h4>
               </div>
             )}
           </div>
        </div>
      </div>
    );
  }

  return null;
};

export default App;
