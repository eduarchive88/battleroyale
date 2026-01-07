
import React, { useState, useEffect, useRef } from 'react';
import { socket } from './services/mockSocket';
import { Role, ClassType, Player, Team, GameState, Quiz } from './types';
import { CLASS_CONFIGS, UPGRADE_COSTS } from './constants';
import { GameCanvas } from './components/GameCanvas';
import { Joystick } from './components/Joystick';

const App: React.FC = () => {
  const [view, setView] = useState<'landing' | 'lobby' | 'game' | 'host'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    isStarted: false,
    teams: {},
    players: {},
    quizzes: []
  });

  const [customCode, setCustomCode] = useState('');
  const [newQuiz, setNewQuiz] = useState<Quiz>({ question: '', options: ['', '', '', ''], answer: 0 });

  useEffect(() => {
    const unsub = socket.subscribe('stateChange', (state: GameState) => {
      setGameState(state);
      if (state.isStarted && view === 'lobby') setView('game');
    });
    return unsub;
  }, [view]);

  const createRoom = () => {
    const finalCode = customCode.trim().toUpperCase() || Math.random().toString(36).substring(2, 7).toUpperCase();
    setRoomCode(finalCode);
    socket.emit('stateChange', { roomCode: finalCode, isStarted: false, players: {}, teams: {}, quizzes: [] });
    setView('host');
  };

  const joinRoom = () => {
    if (!roomCode || !userName) {
      alert("닉네임과 방 코드를 모두 입력해주세요!");
      return;
    }
    setView('lobby');
  };

  const selectRole = (teamId: string, role: Role, classType: ClassType) => {
    const playerId = userName;
    const newPlayer: Player = { id: playerId, name: userName, teamId, role, classType, points: 0 };
    
    const updatedPlayers = { ...gameState.players, [playerId]: newPlayer };
    const updatedTeams = { ...gameState.teams };
    
    if (!updatedTeams[teamId]) {
      updatedTeams[teamId] = {
        id: teamId,
        name: `${teamId} 모둠`,
        points: 0,
        stats: { ...CLASS_CONFIGS[classType] },
        hp: CLASS_CONFIGS[classType].hp,
        maxHp: CLASS_CONFIGS[classType].hp,
        x: Math.random() * 800 + 100,
        y: Math.random() * 800 + 100,
        isDead: false,
        classType
      };
    }

    setMyPlayer(newPlayer);
    socket.emit('stateChange', { players: updatedPlayers, teams: updatedTeams });
  };

  const startGame = () => {
    if (Object.keys(gameState.players).length === 0) {
      alert("학생들이 아직 입장하지 않았습니다.");
      return;
    }
    socket.emit('stateChange', { isStarted: true });
  };

  const handleQuizAnswer = (correct: boolean) => {
    if (!myPlayer) return;
    const pointsToAdd = correct ? 6 : 4;
    const teamId = myPlayer.teamId;
    const updatedTeams = { ...gameState.teams };
    updatedTeams[teamId].points += pointsToAdd;
    socket.emit('stateChange', { teams: updatedTeams });
    alert(correct ? "🎉 정답입니다! +6점" : "😅 아쉽네요! +4점");
  };

  const upgradeStat = (stat: keyof typeof CLASS_CONFIGS[ClassType.WARRIOR]) => {
    if (!myPlayer) return;
    const team = gameState.teams[myPlayer.teamId];
    if (team.points >= UPGRADE_COSTS.STAT) {
      const updatedTeams = { ...gameState.teams };
      const currentVal = updatedTeams[myPlayer.teamId].stats[stat as keyof typeof team.stats] as number;
      (updatedTeams[myPlayer.teamId].stats[stat as keyof typeof team.stats] as any) = currentVal + 5;
      updatedTeams[myPlayer.teamId].points -= UPGRADE_COSTS.STAT;
      socket.emit('stateChange', { teams: updatedTeams });
    } else {
      alert("포인트가 부족합니다!");
    }
  };

  const movePlayer = (dir: { x: number; y: number }) => {
    if (!myPlayer || myPlayer.role !== Role.COMBAT) return;
    const teamId = myPlayer.teamId;
    const team = gameState.teams[teamId];
    if (!team || team.isDead) return;

    const updatedTeams = { ...gameState.teams };
    updatedTeams[teamId].x = Math.max(0, Math.min(1000, team.x + dir.x * 20));
    updatedTeams[teamId].y = Math.max(0, Math.min(1000, team.y + dir.y * 20));
    socket.emit('stateChange', { teams: updatedTeams });
  };

  const attack = () => {
    if (!myPlayer || myPlayer.role !== Role.COMBAT) return;
    const teamId = myPlayer.teamId;
    const myTeam = gameState.teams[teamId];
    const updatedTeams = { ...gameState.teams };

    Object.keys(updatedTeams).forEach(id => {
      if (id === teamId) return;
      const target = updatedTeams[id];
      const dist = Math.sqrt(Math.pow(myTeam.x - target.x, 2) + Math.pow(myTeam.y - target.y, 2));
      if (dist < myTeam.stats.range && !target.isDead) {
        target.hp = Math.max(0, target.hp - myTeam.stats.atk);
        if (target.hp <= 0) target.isDead = true;
      }
    });
    socket.emit('stateChange', { teams: updatedTeams });
  };

  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#020617] text-white">
        <div className="text-center mb-12">
          <h1 className="text-7xl font-black italic bg-clip-text text-transparent bg-gradient-to-b from-white to-blue-500 tracking-tighter">EDU ARENA</h1>
          <p className="text-blue-400 font-bold tracking-[0.3em] uppercase mt-2">Classroom Battle Royale</p>
        </div>
        
        <div className="w-full max-w-md p-10 bg-slate-900/50 backdrop-blur-xl rounded-[2.5rem] border border-white/10 shadow-2xl space-y-8">
          <div className="space-y-4">
            <input 
              className="w-full p-5 bg-slate-800/50 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 font-bold" 
              placeholder="닉네임" 
              value={userName} 
              onChange={e => setUserName(e.target.value)}
            />
            <input 
              className="w-full p-5 bg-slate-800/50 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 uppercase font-black" 
              placeholder="방 코드" 
              value={roomCode} 
              onChange={e => setRoomCode(e.target.value)}
            />
            <button onClick={joinRoom} className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-xl shadow-xl shadow-blue-900/30 transition-all active:scale-95">게임 입장</button>
          </div>
          <div className="flex items-center gap-4 py-2">
            <div className="flex-1 h-px bg-slate-800"></div>
            <span className="text-[10px] text-slate-600 font-black">OR</span>
            <div className="flex-1 h-px bg-slate-800"></div>
          </div>
          <div className="space-y-4">
            <input 
              className="w-full p-4 bg-transparent border border-dashed border-slate-700 rounded-2xl text-center text-slate-500 outline-none" 
              placeholder="직접 지정할 코드 (선택)" 
              value={customCode} 
              onChange={e => setCustomCode(e.target.value)}
            />
            <button onClick={createRoom} className="w-full py-4 bg-slate-800 hover:bg-slate-700 rounded-2xl font-bold text-slate-400 transition-colors">교사용 방 생성</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'host') {
    const players = Object.values(gameState.players) as Player[];
    return (
      <div className="flex flex-col h-screen bg-[#020617] text-white">
        <header className="p-10 border-b border-white/5 flex justify-between items-center">
          <div>
            <h2 className="text-[10px] font-black text-blue-500 tracking-[0.4em] mb-2 uppercase">Room Access Code</h2>
            <div className="text-6xl font-mono font-black">{gameState.roomCode}</div>
          </div>
          <button onClick={startGame} className="px-16 py-6 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-3xl shadow-2xl transition-all active:scale-95">전투 시작</button>
        </header>
        <main className="flex-1 p-10 grid grid-cols-12 gap-10 overflow-hidden">
          <section className="col-span-4 bg-slate-900/20 rounded-[3rem] border border-white/5 p-8 flex flex-col gap-6">
            <h3 className="text-2xl font-black italic flex items-center gap-3">
              <span className="w-3 h-8 bg-blue-500 rounded-full"></span>
              학생 목록 ({players.length})
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
              {players.map(p => (
                <div key={p.id} className="p-5 bg-white/5 rounded-2xl border border-white/5 flex justify-between items-center">
                  <span className="font-black text-xl">{p.name}</span>
                  <span className="text-[10px] bg-blue-600 px-3 py-1 rounded-full font-black uppercase">{p.role}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="col-span-8 bg-slate-900/20 rounded-[3rem] border border-white/5 p-8">
            <h3 className="text-2xl font-black italic mb-8 flex items-center gap-3">
              <span className="w-3 h-8 bg-amber-500 rounded-full"></span>
              퀴즈 관리
            </h3>
            <div className="bg-slate-800/30 p-8 rounded-[2rem] space-y-6">
              <input className="w-full p-5 bg-black/40 border border-white/5 rounded-2xl text-lg font-bold" placeholder="질문을 입력하세요" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
              <div className="grid grid-cols-2 gap-4">
                {newQuiz.options.map((opt, i) => (
                  <input key={i} className="p-4 bg-black/40 border border-white/5 rounded-xl text-sm" placeholder={`보기 ${i+1}`} value={opt} onChange={e => {
                    const opts = [...newQuiz.options];
                    opts[i] = e.target.value;
                    setNewQuiz({...newQuiz, options: opts});
                  }} />
                ))}
              </div>
              <button 
                onClick={() => {
                  if(!newQuiz.question) return;
                  socket.emit('stateChange', { quizzes: [...gameState.quizzes, newQuiz] });
                  setNewQuiz({ question: '', options: ['', '', '', ''], answer: 0 });
                }}
                className="w-full py-5 bg-blue-600 rounded-2xl font-black text-xl transition-all active:scale-95"
              >
                퀴즈 추가
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-[#020617] p-10 text-white flex flex-col items-center overflow-y-auto">
        <h2 className="text-6xl font-black italic tracking-tighter mb-16 uppercase">Team & Role Select</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 w-full max-w-7xl">
          {[1, 2, 3, 4, 5, 6].map(tId => (
            <div key={tId} className={`p-10 rounded-[3rem] border-2 transition-all ${myPlayer?.teamId === tId.toString() ? 'bg-blue-600/10 border-blue-500' : 'bg-slate-900/50 border-white/5 hover:border-white/10'}`}>
              <h3 className="text-3xl font-black italic mb-8">{tId} 모둠</h3>
              <div className="grid grid-cols-1 gap-3">
                <button onClick={() => selectRole(tId.toString(), Role.QUIZ, ClassType.MAGE)} className="p-5 rounded-2xl bg-slate-800 hover:bg-purple-600 font-black transition-colors">🧠 문제 풀이 (마법사)</button>
                <button onClick={() => selectRole(tId.toString(), Role.SUPPORT, ClassType.WARRIOR)} className="p-5 rounded-2xl bg-slate-800 hover:bg-emerald-600 font-black transition-colors">🛡️ 서포트 (전사)</button>
                <button onClick={() => selectRole(tId.toString(), Role.COMBAT, ClassType.ROGUE)} className="p-5 rounded-2xl bg-slate-800 hover:bg-red-600 font-black transition-colors">⚔️ 전투 (도적/궁수)</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-20 animate-pulse text-slate-500 font-black tracking-widest uppercase">Waiting for teacher to start...</div>
      </div>
    );
  }

  if (view === 'game' && myPlayer) {
    const team = gameState.teams[myPlayer.teamId];
    if (!team) return <div className="h-screen bg-black flex items-center justify-center font-black">로딩 중...</div>;
    const currentQuiz = gameState.quizzes[0] || { question: "대기 중입니다.", options: ["곧 시작됩니다", "", "", ""], answer: 0 };

    return (
      <div className="fixed inset-0 bg-black flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 relative order-1 md:order-none">
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer.teamId} />
          
          <div className="absolute top-8 left-8 right-8 flex justify-between pointer-events-none">
            <div className="bg-slate-900/90 p-6 rounded-[2rem] border border-white/10 pointer-events-auto shadow-2xl">
              <div className="text-[10px] text-blue-400 font-black tracking-widest mb-1 uppercase">{team.name} STATUS</div>
              <div className="flex items-center gap-4">
                <div className="text-3xl font-black italic">{team.hp > 0 ? 'Alive' : 'Dead'}</div>
                <div className="w-40 h-3 bg-black rounded-full overflow-hidden border border-white/5">
                  <div className="h-full bg-gradient-to-r from-red-600 to-rose-400" style={{ width: `${(team.hp/team.maxHp)*100}%` }} />
                </div>
              </div>
            </div>
            <div className="bg-amber-500 px-8 py-4 rounded-3xl pointer-events-auto shadow-2xl text-black font-black text-4xl italic">
              {team.points} <span className="text-sm not-italic opacity-60">PTS</span>
            </div>
          </div>

          {myPlayer.role === Role.COMBAT && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-125 origin-bottom-left">
                <Joystick onMove={movePlayer} />
              </div>
              <div className="absolute bottom-16 right-16">
                <button onClick={attack} className="w-32 h-32 bg-red-600 rounded-full shadow-2xl border-4 border-white/20 active:scale-90 flex flex-col items-center justify-center font-black">
                  <span className="text-5xl mb-1">⚔️</span>
                  <span className="text-[10px] tracking-widest">ATTACK</span>
                </button>
              </div>
            </>
          )}
        </div>

        <div className="w-full md:w-96 bg-slate-900 border-l border-white/5 p-10 flex flex-col gap-10 order-2 md:order-none shadow-2xl">
          <header>
            <h3 className="text-[10px] text-blue-500 font-black tracking-[0.3em] uppercase mb-2">My Role</h3>
            <div className="text-3xl font-black italic text-white uppercase">{myPlayer.role} PLAYER</div>
          </header>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {myPlayer.role === Role.QUIZ && (
              <div className="space-y-6">
                <div className="p-8 bg-slate-800/50 rounded-[2rem] border border-white/5">
                  <h4 className="text-xl font-black mb-8 leading-tight">Q. {currentQuiz.question}</h4>
                  <div className="space-y-3">
                    {currentQuiz.options.map((opt, i) => opt && (
                      <button key={i} onClick={() => handleQuizAnswer(i === currentQuiz.answer)} className="w-full p-6 bg-slate-700 hover:bg-blue-600 rounded-2xl text-left font-bold border border-white/5 transition-colors">
                        {i+1}. {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {myPlayer.role === Role.SUPPORT && (
              <div className="space-y-4">
                <button onClick={() => upgradeStat('atk')} className="w-full p-6 bg-red-900/20 border border-red-500/20 rounded-3xl flex justify-between items-center hover:bg-red-600 transition-all">
                  <div className="flex items-center gap-4 text-left">
                    <span className="text-3xl">⚔️</span>
                    <div>
                      <div className="font-black text-xl">공격력 강화</div>
                      <div className="text-[10px] opacity-60 uppercase font-black">ATK LV.{team.stats.atk}</div>
                    </div>
                  </div>
                </button>
                <button onClick={() => upgradeStat('def')} className="w-full p-6 bg-blue-900/20 border border-blue-500/20 rounded-3xl flex justify-between items-center hover:bg-blue-600 transition-all">
                  <div className="flex items-center gap-4 text-left">
                    <span className="text-3xl">🛡️</span>
                    <div>
                      <div className="font-black text-xl">방어력 강화</div>
                      <div className="text-[10px] opacity-60 uppercase font-black">DEF LV.{team.stats.def}</div>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {myPlayer.role === Role.COMBAT && (
              <div className="p-10 bg-slate-800/40 rounded-[3rem] border border-white/5 flex flex-col items-center">
                <div className="w-40 h-40 bg-white/5 rounded-full flex items-center justify-center text-8xl mb-6">
                  {team.classType === ClassType.WARRIOR && '🛡️'}
                  {team.classType === ClassType.MAGE && '🔮'}
                  {team.classType === ClassType.ARCHER && '🏹'}
                  {team.classType === ClassType.ROGUE && '🗡️'}
                </div>
                <h4 className="text-4xl font-black italic uppercase tracking-tighter mb-2">{team.classType}</h4>
                <p className="text-[10px] text-slate-500 font-black tracking-widest text-center uppercase">Arena Ace</p>
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
