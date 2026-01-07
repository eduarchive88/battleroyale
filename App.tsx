
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
  const [gameState, setGameState] = useState<GameState>({
    isStarted: false,
    teams: {},
    players: {},
    quizzes: []
  });

  // Host states
  const [customCode, setCustomCode] = useState('');
  const [quizList, setQuizList] = useState<Quiz[]>([]);
  const [newQuiz, setNewQuiz] = useState<Quiz>({ question: '', options: ['', '', '', ''], answer: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = socket.subscribe('stateChange', (state: GameState) => {
      setGameState(state);
      if (state.isStarted && view === 'lobby') setView('game');
    });
    return unsub;
  }, [view]);

  // CSV Parsing
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').slice(1); // Header 제외
      const loadedQuizzes: Quiz[] = lines.filter(line => line.trim()).map(line => {
        const parts = line.split(',');
        return {
          question: parts[0]?.trim(),
          options: [parts[1], parts[2], parts[3], parts[4]].map(o => o?.trim()),
          answer: (parseInt(parts[5]) - 1) || 0
        };
      });
      setQuizList([...quizList, ...loadedQuizzes]);
    };
    reader.readAsText(file);
  };

  const createRoom = () => {
    const finalCode = customCode.trim().toUpperCase() || Math.random().toString(36).substring(2, 7).toUpperCase();
    setRoomCode(finalCode);
    socket.emit('stateChange', { 
      roomCode: finalCode, 
      isStarted: false, 
      players: {}, 
      teams: {}, 
      quizzes: quizList 
    });
    setView('host_lobby');
  };

  const selectRole = (teamId: string, role: Role, classType: ClassType) => {
    if (!userName) return alert("닉네임을 먼저 입력하세요!");
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

  const handleQuizAnswer = (correct: boolean) => {
    if (!myPlayer) return;
    const pointsToAdd = correct ? 6 : 4;
    const updatedTeams = { ...gameState.teams };
    updatedTeams[myPlayer.teamId].points += pointsToAdd;
    socket.emit('stateChange', { teams: updatedTeams });
    alert(correct ? "✨ 정답! 마력 +6 획득!" : "💀 오답! 마력 +4 획득");
  };

  const movePlayer = (dir: { x: number; y: number }) => {
    if (!myPlayer || myPlayer.role !== Role.COMBAT) return;
    const team = gameState.teams[myPlayer.teamId];
    if (!team || team.isDead) return;
    const updatedTeams = { ...gameState.teams };
    updatedTeams[myPlayer.teamId].x = Math.max(0, Math.min(1000, team.x + dir.x * 20));
    updatedTeams[myPlayer.teamId].y = Math.max(0, Math.min(1000, team.y + dir.y * 20));
    socket.emit('stateChange', { teams: updatedTeams });
  };

  // Implement attack logic
  const attack = () => {
    if (!myPlayer || myPlayer.role !== Role.COMBAT) return;
    const myTeam = gameState.teams[myPlayer.teamId];
    if (!myTeam || myTeam.isDead) return;

    const updatedTeams = { ...gameState.teams };
    let targetId: string | null = null;
    let minDist = Infinity;

    // Find nearest target
    Object.values(updatedTeams).forEach(t => {
      if (t.id === myPlayer.teamId || t.isDead) return;
      const d = Math.sqrt(Math.pow(t.x - myTeam.x, 2) + Math.pow(t.y - myTeam.y, 2));
      if (d < myTeam.stats.range && d < minDist) {
        minDist = d;
        targetId = t.id;
      }
    });

    if (targetId) {
      const target = updatedTeams[targetId];
      const damage = Math.max(1, myTeam.stats.atk - target.stats.def);
      target.hp -= damage;
      if (target.hp <= 0) {
        target.hp = 0;
        target.isDead = true;
      }
      socket.emit('stateChange', { teams: updatedTeams });
    }
  };

  if (view === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#020617] text-white bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <div className="text-center mb-12 animate-pulse">
          <h1 className="text-8xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-blue-300 via-white to-blue-600 drop-shadow-2xl">EDU ARENA</h1>
          <p className="text-blue-400 font-bold tracking-[0.5em] mt-4">판타지 클래스 서바이벌</p>
        </div>
        <div className="w-full max-w-md p-10 bg-slate-900/80 backdrop-blur-xl rounded-[3rem] border-2 border-blue-500/30 shadow-[0_0_50px_rgba(59,130,246,0.2)] space-y-8">
          <div className="space-y-4">
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 font-bold" placeholder="영웅의 이름 (닉네임)" value={userName} onChange={e => setUserName(e.target.value)} />
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 uppercase font-black" placeholder="차원 코드 (방 코드)" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button onClick={() => roomCode ? setView('lobby') : alert("코드를 입력하세요")} className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-2xl shadow-lg transition-transform active:scale-95">모험 시작</button>
          </div>
          <div className="flex items-center gap-4 py-2 opacity-50"><div className="flex-1 h-px bg-slate-700"></div><span className="text-xs font-black">OR</span><div className="flex-1 h-px bg-slate-700"></div></div>
          <button onClick={() => setView('host_setup')} className="w-full py-4 bg-slate-800 hover:bg-slate-700 rounded-2xl font-bold text-slate-400">교사용 전장 설계 (Host)</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="flex flex-col h-screen bg-[#020617] text-white p-10 overflow-y-auto">
        <header className="mb-10 flex justify-between items-center">
          <h2 className="text-4xl font-black italic text-blue-400">전장 설계실</h2>
          <button onClick={() => setView('landing')} className="text-slate-500 hover:text-white">돌아가기</button>
        </header>
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-5 space-y-6">
            <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-blue-500/20 shadow-xl space-y-6">
              <h3 className="text-xl font-black border-b border-white/5 pb-4">1. 퀴즈 직접 입력</h3>
              <input className="w-full p-4 bg-black/40 border border-white/5 rounded-xl font-bold" placeholder="질문" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
              <div className="grid grid-cols-2 gap-2">
                {newQuiz.options.map((opt, i) => (
                  <input key={i} className="p-3 bg-black/40 border border-white/5 rounded-lg text-sm" placeholder={`보기 ${i+1}`} value={opt} onChange={e => {
                    const opts = [...newQuiz.options];
                    opts[i] = e.target.value;
                    setNewQuiz({...newQuiz, options: opts});
                  }} />
                ))}
              </div>
              <button onClick={() => { if(newQuiz.question) { setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); } }} className="w-full py-4 bg-blue-600 rounded-xl font-black">목록에 추가</button>
            </div>
            <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-emerald-500/20 shadow-xl space-y-4">
              <h3 className="text-xl font-black border-b border-white/5 pb-4">2. 엑셀 업로드 (CSV)</h3>
              <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleFileUpload} />
              <button onClick={() => fileInputRef.current?.click()} className="w-full py-4 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-xl font-bold">파일 선택</button>
              <button onClick={() => {
                const blob = new Blob(["\ufeff문제,보기1,보기2,보기3,보기4,정답(1-4)\n대한민국의 수도는?,인천,서울,부산,대구,2"], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.setAttribute("download", "edu_arena_template.csv");
                link.click();
              }} className="w-full text-xs text-slate-500 underline">샘플 양식 다운로드</button>
            </div>
          </div>
          <div className="col-span-7 space-y-6">
             <div className="bg-slate-950/50 p-8 rounded-[2.5rem] border border-white/5 h-[400px] overflow-y-auto custom-scrollbar">
                <h3 className="text-xl font-black mb-4">입력된 퀴즈 리스트 ({quizList.length})</h3>
                {quizList.map((q, i) => (
                  <div key={i} className="p-4 bg-white/5 rounded-xl mb-2 flex justify-between items-center">
                    <span>{i+1}. {q.question}</span>
                    <button onClick={() => setQuizList(quizList.filter((_, idx) => idx !== i))} className="text-red-500 text-xs font-bold">삭제</button>
                  </div>
                ))}
             </div>
             <div className="bg-blue-600/10 p-10 rounded-[2.5rem] border-2 border-blue-600 shadow-2xl flex flex-col items-center gap-6">
                <input className="w-full p-5 bg-black rounded-2xl text-center text-2xl font-black uppercase tracking-widest border border-blue-500/50" placeholder="사용할 방 코드 지정 (비워두면 자동생성)" value={customCode} onChange={e => setCustomCode(e.target.value)} />
                <button onClick={createRoom} className="w-full py-6 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-3xl shadow-xl transition-all active:scale-95">방 생성 및 전장 오픈</button>
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
        <header className="flex justify-between items-center mb-10">
          <div>
            <p className="text-blue-500 font-black text-[10px] tracking-widest uppercase mb-1">Entrance Code</p>
            <h2 className="text-7xl font-mono font-black">{gameState.roomCode}</h2>
          </div>
          <button onClick={() => socket.emit('stateChange', { isStarted: true })} className="px-20 py-8 bg-emerald-600 hover:bg-emerald-500 rounded-[2rem] font-black text-4xl shadow-2xl">게임 시작 (Start Battle)</button>
        </header>
        <div className="flex-1 bg-slate-900/40 rounded-[3rem] border border-white/5 p-10 overflow-hidden flex flex-col">
          <h3 className="text-2xl font-black italic mb-6">대기 중인 영웅들 ({players.length})</h3>
          <div className="grid grid-cols-4 gap-6 overflow-y-auto custom-scrollbar pr-4">
            {players.map(p => (
              <div key={p.id} className="p-6 bg-white/5 border border-white/10 rounded-[2rem] flex flex-col items-center">
                <div className="text-4xl mb-2">
                   {p.classType === ClassType.WARRIOR && '🛡️'}
                   {p.classType === ClassType.MAGE && '🔮'}
                   {p.classType === ClassType.ARCHER && '🏹'}
                   {p.classType === ClassType.ROGUE && '🗡️'}
                </div>
                <span className="font-black text-xl">{p.name}</span>
                <span className="text-[10px] text-blue-400 font-bold mt-1 uppercase">{p.role} / {p.teamId}모둠</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-[#020617] p-10 text-white flex flex-col items-center">
        <h2 className="text-6xl font-black italic mb-16 tracking-tighter">진영 및 직업 선택</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 w-full max-w-7xl">
          {[1,2,3,4,5,6].map(tId => (
            <div key={tId} className={`p-10 rounded-[3rem] border-2 transition-all ${myPlayer?.teamId === tId.toString() ? 'bg-blue-600/20 border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)]' : 'bg-slate-900/50 border-white/5'}`}>
              <h3 className="text-3xl font-black italic mb-8">{tId} 모둠</h3>
              <div className="grid grid-cols-1 gap-3">
                <button onClick={() => selectRole(tId.toString(), Role.QUIZ, ClassType.MAGE)} className="p-5 rounded-2xl bg-purple-900/30 border border-purple-500/30 hover:bg-purple-600 transition-all font-black flex items-center gap-4"><span>🔮</span> 문제풀이 (마법사)</button>
                <button onClick={() => selectRole(tId.toString(), Role.SUPPORT, ClassType.WARRIOR)} className="p-5 rounded-2xl bg-emerald-900/30 border border-emerald-500/30 hover:bg-emerald-600 transition-all font-black flex items-center gap-4"><span>🛡️</span> 서포트 (전사)</button>
                <button onClick={() => selectRole(tId.toString(), Role.COMBAT, ClassType.ROGUE)} className="p-5 rounded-2xl bg-red-900/30 border border-red-500/30 hover:bg-red-600 transition-all font-black flex items-center gap-4"><span>🗡️</span> 전투 (도적/궁수)</button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-20 text-slate-500 font-black animate-pulse tracking-widest uppercase">전투 개시 대기 중...</p>
      </div>
    );
  }

  if (view === 'game' && myPlayer) {
    const team = gameState.teams[myPlayer.teamId];
    if (!team) return <div className="h-screen bg-black flex items-center justify-center font-black">데이터 수신 중...</div>;
    const currentQuiz = gameState.quizzes[0] || { question: "모든 시련을 극복했습니다.", options: ["교사를 기다리세요", "", "", ""], answer: 0 };

    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col md:flex-row overflow-hidden select-none">
        <div className="flex-1 relative order-1 md:order-none">
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer.teamId} />
          <div className="absolute top-8 left-8 flex gap-6 pointer-events-none">
            <div className="bg-slate-900/90 p-6 rounded-[2rem] border border-white/10 pointer-events-auto shadow-2xl flex items-center gap-4">
              <div className="text-center">
                <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest">{team.name}</p>
                <h4 className="text-3xl font-black italic text-white leading-none">{team.hp > 0 ? '전투 중' : '탈락'}</h4>
              </div>
              <div className="w-40 h-4 bg-black rounded-full border border-white/5 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-red-600 to-rose-400 transition-all" style={{ width: `${(team.hp/team.maxHp)*100}%` }} />
              </div>
            </div>
            <div className="bg-amber-500 px-8 py-5 rounded-[2rem] text-black font-black text-4xl italic pointer-events-auto shadow-2xl">{team.points} P</div>
          </div>
          {myPlayer.role === Role.COMBAT && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-125 origin-bottom-left"><Joystick onMove={movePlayer} /></div>
              <div className="absolute bottom-16 right-16">
                <button onClick={() => attack()} className="w-32 h-32 bg-red-600 rounded-full shadow-[0_0_50px_rgba(220,38,38,0.5)] border-4 border-white/20 active:scale-90 flex flex-col items-center justify-center font-black">
                   <span className="text-5xl mb-1">⚔️</span>
                   <span className="text-[10px] tracking-widest">ATTACK</span>
                </button>
              </div>
            </>
          )}
        </div>
        <div className="w-full md:w-96 bg-slate-900/95 border-l border-white/10 p-10 flex flex-col gap-10 order-2 md:order-none shadow-[-20px_0_50px_rgba(0,0,0,0.5)]">
           <header><h3 className="text-xs text-blue-500 font-black tracking-widest uppercase mb-1">Current Role</h3><div className="text-3xl font-black italic text-white uppercase">{myPlayer.role}</div></header>
           <div className="flex-1 overflow-y-auto custom-scrollbar">
             {myPlayer.role === Role.QUIZ && (
               <div className="space-y-6 animate-in fade-in slide-in-from-right duration-300">
                  <div className="p-8 bg-slate-800/50 rounded-[2.5rem] border border-white/5">
                    <h4 className="text-xl font-black mb-8 leading-tight">Q. {currentQuiz.question}</h4>
                    <div className="space-y-3">
                      {currentQuiz.options.map((opt, i) => opt && (
                        <button key={i} onClick={() => handleQuizAnswer(i === currentQuiz.answer)} className="w-full p-6 bg-slate-700/50 hover:bg-blue-600 rounded-2xl text-left font-bold transition-all border border-white/5">{i+1}. {opt}</button>
                      ))}
                    </div>
                  </div>
               </div>
             )}
             {myPlayer.role === Role.SUPPORT && (
               <div className="space-y-4 animate-in fade-in slide-in-from-right duration-300">
                  <button onClick={() => {
                    if(team.points < 10) return alert("포인트 부족!");
                    const updatedTeams = { ...gameState.teams };
                    updatedTeams[myPlayer.teamId].stats.atk += 5;
                    updatedTeams[myPlayer.teamId].points -= 10;
                    socket.emit('stateChange', { teams: updatedTeams });
                  }} className="w-full p-6 bg-red-900/20 border border-red-500/20 rounded-3xl flex justify-between items-center group hover:bg-red-600 transition-all">
                    <div className="flex items-center gap-4 text-left"><span className="text-3xl">⚔️</span><div><div className="font-black text-xl">공격력 강화</div><div className="text-[10px] opacity-60">ATK LV.{team.stats.atk}</div></div></div>
                  </button>
                  <button onClick={() => {
                    if(team.points < 10) return alert("포인트 부족!");
                    const updatedTeams = { ...gameState.teams };
                    updatedTeams[myPlayer.teamId].hp = Math.min(team.maxHp, team.hp + 50);
                    updatedTeams[myPlayer.teamId].points -= 10;
                    socket.emit('stateChange', { teams: updatedTeams });
                  }} className="w-full p-6 bg-emerald-900/20 border border-emerald-500/20 rounded-3xl flex justify-between items-center group hover:bg-emerald-600 transition-all">
                    <div className="flex items-center gap-4 text-left"><span className="text-3xl">❤️</span><div><div className="font-black text-xl">생명력 회복</div><div className="text-[10px] opacity-60">HEAL HP</div></div></div>
                  </button>
               </div>
             )}
             {myPlayer.role === Role.COMBAT && (
               <div className="p-10 bg-slate-800/40 rounded-[3rem] border-2 border-white/5 flex flex-col items-center animate-in zoom-in duration-500">
                  <div className="w-44 h-44 bg-white/5 rounded-full flex items-center justify-center text-8xl mb-6 shadow-inner">{team.classType === ClassType.WARRIOR ? '🛡️' : team.classType === ClassType.MAGE ? '🔮' : team.classType === ClassType.ARCHER ? '🏹' : '🗡️'}</div>
                  <h4 className="text-4xl font-black italic uppercase mb-2">{team.classType}</h4>
                  <div className="text-center space-y-1"><div className="text-xs font-bold text-slate-500">ATK {team.stats.atk} / RANGE {team.stats.range}</div></div>
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
