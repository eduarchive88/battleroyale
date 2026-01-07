
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').slice(1);
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
      quizzes: quizList,
      currentQuizIndex: 0,
      phase: 'QUIZ'
    });
    setView('host_lobby');
  };

  const selectRole = (teamId: string, role: Role, classType?: ClassType) => {
    if (!userName) return alert("닉네임을 입력하세요!");
    
    // 서포터 인원 제한 체크 (최대 2명)
    if (role === Role.SUPPORT) {
      const supporterCount = Object.values(gameState.players).filter(p => p.teamId === teamId && p.role === Role.SUPPORT).length;
      if (supporterCount >= 2) return alert("이 모둠의 서포터는 이미 가득 찼습니다!");
    }

    // 전투요원 중복 체크
    if (role === Role.COMBAT) {
      const hasCombat = Object.values(gameState.players).some(p => p.teamId === teamId && p.role === Role.COMBAT);
      if (hasCombat) return alert("이 모둠의 전투요원은 이미 존재합니다!");
    }

    const playerId = userName;
    const newPlayer: Player = { id: playerId, name: userName, teamId, role, classType: classType || ClassType.WARRIOR, points: 0 };
    const updatedPlayers = { ...gameState.players, [playerId]: newPlayer };
    const updatedTeams = { ...gameState.teams };
    
    if (!updatedTeams[teamId]) {
      updatedTeams[teamId] = {
        id: teamId,
        name: `${teamId} 모둠`,
        points: 0,
        stats: { ...CLASS_CONFIGS[ClassType.WARRIOR] },
        hp: CLASS_CONFIGS[ClassType.WARRIOR].hp,
        maxHp: CLASS_CONFIGS[ClassType.WARRIOR].hp,
        x: Math.random() * 600 + 200,
        y: Math.random() * 600 + 200,
        isDead: false,
        classType: ClassType.WARRIOR
      };
    }

    // 전투요원이 직업을 바꿀 경우 팀 데이터 업데이트
    if (role === Role.COMBAT && classType) {
      updatedTeams[teamId].classType = classType;
      updatedTeams[teamId].stats = { ...CLASS_CONFIGS[classType] };
      updatedTeams[teamId].hp = CLASS_CONFIGS[classType].hp;
      updatedTeams[teamId].maxHp = CLASS_CONFIGS[classType].hp;
    }

    setMyPlayer(newPlayer);
    socket.emit('stateChange', { players: updatedPlayers, teams: updatedTeams });
  };

  const handleQuizAnswer = (correct: boolean) => {
    if (!myPlayer) return;
    const pointsToAdd = correct ? 6 : 4;
    const updatedTeams = { ...gameState.teams };
    updatedTeams[myPlayer.teamId].points += pointsToAdd;
    
    // 문제풀이 완료 시 자동으로 전투 페이즈 전환 (교사 UI에서 관리 권장이나 학생 인터페이스에서도 가능하게)
    socket.emit('stateChange', { 
      teams: updatedTeams,
      phase: 'BATTLE' 
    });
    alert(correct ? "✨ 정답! 포인트 +6 획득! 전투 단계로 전환됩니다." : "💀 오답! 포인트 +4 획득. 전투 단계로 전환됩니다.");
  };

  const nextRound = () => {
    const nextIdx = gameState.currentQuizIndex + 1;
    if (nextIdx >= gameState.quizzes.length) {
      alert("모든 라운드가 종료되었습니다!");
      return;
    }
    socket.emit('stateChange', { 
      currentQuizIndex: nextIdx,
      phase: 'QUIZ'
    });
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
        <div className="text-center mb-12">
          <h1 className="text-8xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-blue-300 via-white to-blue-600 drop-shadow-[0_0_30px_rgba(59,130,246,0.5)]">EDU ARENA</h1>
          <p className="text-blue-400 font-bold tracking-[0.5em] mt-4 uppercase">Fantasy Battle Royale</p>
        </div>
        <div className="w-full max-w-md p-10 bg-slate-900/80 backdrop-blur-2xl rounded-[3rem] border-2 border-blue-500/30 shadow-2xl space-y-8">
          <div className="space-y-4">
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 font-bold" placeholder="영웅 닉네임" value={userName} onChange={e => setUserName(e.target.value)} />
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 uppercase font-black" placeholder="방 코드" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button onClick={() => roomCode ? setView('lobby') : alert("코드를 입력하세요")} className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-2xl shadow-xl transition-transform active:scale-95">입장하기</button>
          </div>
          <button onClick={() => setView('host_setup')} className="w-full py-4 bg-slate-800/50 hover:bg-slate-800 rounded-2xl font-bold text-slate-500 hover:text-white transition-colors">교사용 전장 설계</button>
        </div>
      </div>
    );
  }

  if (view === 'host_setup') {
    return (
      <div className="flex flex-col h-screen bg-[#020617] text-white p-10 overflow-y-auto">
        <header className="mb-10 flex justify-between items-center border-b border-white/5 pb-6">
          <h2 className="text-4xl font-black italic text-blue-400">교사 전용: 라운드 설정</h2>
          <button onClick={() => setView('landing')} className="bg-slate-800 px-6 py-2 rounded-xl text-sm font-bold">뒤로가기</button>
        </header>
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-5 space-y-6">
            <div className="bg-slate-900 p-8 rounded-[3rem] border border-blue-500/20 shadow-2xl">
              <h3 className="text-xl font-black mb-6 flex items-center gap-2"><span className="w-2 h-6 bg-blue-500 rounded-full"></span> 퀴즈 직접 입력</h3>
              <div className="space-y-4">
                <input className="w-full p-4 bg-black/50 border border-white/5 rounded-xl font-bold" placeholder="질문 내용을 입력하세요" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
                <div className="grid grid-cols-2 gap-3">
                  {newQuiz.options.map((opt, i) => (
                    <input key={i} className="p-3 bg-black/50 border border-white/5 rounded-xl text-sm" placeholder={`보기 ${i+1}`} value={opt} onChange={e => {
                      const opts = [...newQuiz.options];
                      opts[i] = e.target.value;
                      setNewQuiz({...newQuiz, options: opts});
                    }} />
                  ))}
                </div>
                <button onClick={() => { if(newQuiz.question) { setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); } }} className="w-full py-4 bg-blue-600 rounded-2xl font-black text-lg">리스트에 추가</button>
              </div>
            </div>
            <div className="bg-slate-900 p-8 rounded-[3rem] border border-emerald-500/20 shadow-2xl">
              <h3 className="text-xl font-black mb-4 flex items-center gap-2"><span className="w-2 h-6 bg-emerald-500 rounded-full"></span> 엑셀(CSV) 업로드</h3>
              <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleFileUpload} />
              <button onClick={() => fileInputRef.current?.click()} className="w-full py-4 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-2xl font-bold">파일 선택 및 업로드</button>
              <button onClick={() => {
                const blob = new Blob(["\ufeff문제,보기1,보기2,보기3,보기4,정답(1-4)\n사과는 영어로?,Apple,Banana,Grape,Peach,1"], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.setAttribute("download", "quiz_template.csv");
                link.click();
              }} className="w-full text-center mt-3 text-xs text-slate-500 underline">샘플 양식 다운로드</button>
            </div>
          </div>
          <div className="col-span-7 space-y-8">
            <div className="bg-slate-950 p-8 rounded-[3rem] border border-white/5 h-[450px] overflow-y-auto custom-scrollbar shadow-inner">
               <h3 className="text-xl font-black mb-6">전체 퀴즈 리스트 ({quizList.length})</h3>
               {quizList.map((q, i) => (
                 <div key={i} className="p-5 bg-white/5 rounded-2xl mb-3 flex justify-between items-center border border-white/5">
                   <span className="font-bold">{i+1}. {q.question}</span>
                   <button onClick={() => setQuizList(quizList.filter((_, idx) => idx !== i))} className="text-red-500 font-black text-sm">삭제</button>
                 </div>
               ))}
            </div>
            <div className="bg-blue-600/10 p-10 rounded-[3rem] border-2 border-blue-600 shadow-2xl flex flex-col gap-6">
               <input className="w-full p-5 bg-black rounded-2xl text-center text-3xl font-black uppercase tracking-[0.3em] border border-blue-500/50 outline-none focus:ring-4 ring-blue-500/30" placeholder="방 코드 (선택)" value={customCode} onChange={e => setCustomCode(e.target.value)} />
               <button onClick={createRoom} className="w-full py-6 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-3xl shadow-xl transition-all active:scale-95">방 생성 및 학생 대기</button>
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
        <header className="flex justify-between items-center mb-10 bg-slate-900/50 p-8 rounded-[3rem] border border-white/5 shadow-2xl">
          <div className="flex gap-10 items-center">
            <div>
              <p className="text-blue-500 font-black text-xs tracking-widest uppercase mb-1 opacity-60">Entrance Code</p>
              <h2 className="text-7xl font-mono font-black text-white">{gameState.roomCode}</h2>
            </div>
            <div className="w-px h-16 bg-white/10"></div>
            <div>
              <p className="text-emerald-500 font-black text-xs tracking-widest uppercase mb-1 opacity-60">Students Joined</p>
              <h2 className="text-5xl font-black">{players.length} <span className="text-xl text-slate-500 italic">HEROES</span></h2>
            </div>
          </div>
          <div className="flex gap-4">
             {gameState.phase === 'BATTLE' && <button onClick={nextRound} className="px-10 py-6 bg-amber-600 hover:bg-amber-500 rounded-3xl font-black text-2xl shadow-xl transition-all">다음 라운드 진행</button>}
             <button onClick={() => socket.emit('stateChange', { isStarted: true })} className="px-16 py-8 bg-blue-600 hover:bg-blue-500 rounded-3xl font-black text-3xl shadow-2xl">게임 시작</button>
          </div>
        </header>
        <div className="flex-1 bg-slate-900/30 rounded-[3rem] border border-white/5 p-10 overflow-hidden">
          <h3 className="text-2xl font-black italic mb-8 flex items-center gap-3"><span className="w-2 h-8 bg-blue-500 rounded-full"></span> 접속 현황</h3>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-6 overflow-y-auto custom-scrollbar h-full pb-20">
            {players.map(p => (
              <div key={p.id} className="p-6 bg-white/5 border border-white/10 rounded-3xl flex flex-col items-center hover:bg-white/10 transition-colors">
                <div className="text-5xl mb-3">
                   {p.role === Role.COMBAT ? (p.classType === ClassType.WARRIOR ? '🛡️' : p.classType === ClassType.MAGE ? '🔮' : p.classType === ClassType.ARCHER ? '🏹' : '🗡️') : (p.role === Role.QUIZ ? '🧠' : '🛡️')}
                </div>
                <span className="font-black text-lg">{p.name}</span>
                <span className="text-[10px] text-blue-400 font-black uppercase mt-2">{p.teamId}모둠 · {p.role}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-[#020617] p-10 text-white flex flex-col items-center overflow-y-auto">
        <h2 className="text-7xl font-black italic mb-16 tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-white">모둠 및 역할 선택</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-[1400px]">
          {[1,2,3,4,5,6,7,8,9].map(tId => (
            <div key={tId} className={`p-8 rounded-[3rem] border-2 transition-all ${myPlayer?.teamId === tId.toString() ? 'bg-blue-600/20 border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.3)]' : 'bg-slate-900/50 border-white/5'}`}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-4xl font-black italic">{tId} <span className="text-xl not-italic opacity-50">Team</span></h3>
                <div className="flex gap-1">
                  {[...Array(Object.values(gameState.players).filter(p => p.teamId === tId.toString()).length)].map((_, i) => (
                    <div key={i} className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <button onClick={() => selectRole(tId.toString(), Role.QUIZ)} className="p-4 rounded-2xl bg-slate-800 hover:bg-blue-600 font-black flex items-center gap-4 transition-all"><span>🧠</span> 문제풀이 담당</button>
                <button onClick={() => selectRole(tId.toString(), Role.SUPPORT)} className="p-4 rounded-2xl bg-slate-800 hover:bg-emerald-600 font-black flex items-center gap-4 transition-all"><span>🛡️</span> 서포터 (최대 2명)</button>
                
                {/* 전투요원은 직업 선택까지 */}
                <div className="mt-4 pt-4 border-t border-white/5">
                   <p className="text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">전투요원 & 캐릭터 선택</p>
                   <div className="grid grid-cols-2 gap-2">
                     <button onClick={() => selectRole(tId.toString(), Role.COMBAT, ClassType.WARRIOR)} className="p-3 bg-slate-900 hover:bg-red-800 rounded-xl text-xs font-black transition-all">🛡️ 전사</button>
                     {/* Fix incorrect enum types by using ClassType instead of Role */}
                     <button onClick={() => selectRole(tId.toString(), Role.COMBAT, ClassType.MAGE)} className="p-3 bg-slate-900 hover:bg-purple-800 rounded-xl text-xs font-black transition-all">🔮 마법사</button>
                     <button onClick={() => selectRole(tId.toString(), Role.COMBAT, ClassType.ARCHER)} className="p-3 bg-slate-900 hover:bg-amber-800 rounded-xl text-xs font-black transition-all">🏹 궁수</button>
                     <button onClick={() => selectRole(tId.toString(), Role.COMBAT, ClassType.ROGUE)} className="p-3 bg-slate-900 hover:bg-slate-700 rounded-xl text-xs font-black transition-all">🗡️ 도적</button>
                   </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-20 text-slate-500 font-black animate-pulse tracking-widest uppercase italic">The Battle Begins Soon...</p>
      </div>
    );
  }

  if (view === 'game' && myPlayer) {
    const team = gameState.teams[myPlayer.teamId];
    if (!team) return <div className="h-screen bg-black flex items-center justify-center font-black">데이터 동기화 중...</div>;
    
    // Using property access instead of cast now that GameState is updated
    const currentQuizIdx = gameState.currentQuizIndex || 0;
    const currentQuiz = gameState.quizzes[currentQuizIdx] || { question: "모든 시련을 극복했습니다.", options: ["교사를 기다리세요", "", "", ""], answer: 0 };
    const phase = gameState.phase || 'QUIZ';

    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col md:flex-row overflow-hidden select-none">
        {/* Arena View */}
        <div className="flex-1 relative order-1 md:order-none">
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer.teamId} />
          
          {/* Top Info HUD */}
          <div className="absolute top-8 left-8 right-8 flex justify-between pointer-events-none items-start">
            <div className="bg-slate-900/90 backdrop-blur-xl p-6 rounded-[2.5rem] border border-white/10 pointer-events-auto shadow-2xl flex items-center gap-6">
              <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center text-4xl shadow-inner border border-blue-500/20">
                 {team.classType === ClassType.WARRIOR ? '🛡️' : team.classType === ClassType.MAGE ? '🔮' : team.classType === ClassType.ARCHER ? '🏹' : '🗡️'}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                   <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest">{team.name}</p>
                   <span className={`text-[10px] px-2 py-0.5 rounded-full font-black text-white ${phase === 'QUIZ' ? 'bg-amber-500' : 'bg-red-600'}`}>{phase} PHASE</span>
                </div>
                <div className="flex items-center gap-4">
                  <h4 className="text-3xl font-black italic text-white leading-none">{team.hp > 0 ? 'ALIVE' : 'DEFEATED'}</h4>
                  <div className="w-48 h-3 bg-black rounded-full border border-white/5 overflow-hidden shadow-inner">
                    <div className="h-full bg-gradient-to-r from-red-600 to-rose-400 transition-all duration-500" style={{ width: `${(team.hp/team.maxHp)*100}%` }} />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col gap-2 items-end">
              <div className="bg-gradient-to-r from-amber-400 to-orange-600 p-0.5 rounded-3xl shadow-2xl pointer-events-auto">
                 <div className="bg-slate-900 px-8 py-4 rounded-[1.4rem] flex flex-col items-center">
                    <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Accumulated Energy</span>
                    <div className="text-4xl font-black text-white italic">{team.points} <span className="text-sm not-italic opacity-50">PTS</span></div>
                 </div>
              </div>
              <div className="bg-white/5 backdrop-blur px-6 py-2 rounded-2xl border border-white/10 text-xs font-black pointer-events-auto">
                 ROUND {currentQuizIdx + 1} / {gameState.quizzes.length}
              </div>
            </div>
          </div>

          {/* Controls for Fighter during BATTLE */}
          {myPlayer.role === Role.COMBAT && phase === 'BATTLE' && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-125 origin-bottom-left"><Joystick onMove={movePlayer} /></div>
              <div className="absolute bottom-16 right-16">
                <button onClick={attack} className="w-36 h-36 bg-red-600 rounded-full shadow-[0_0_60px_rgba(220,38,38,0.6)] border-4 border-white/20 active:scale-90 flex flex-col items-center justify-center font-black transform transition-all group">
                   <span className="text-6xl mb-1 group-hover:scale-110 transition">⚔️</span>
                   <span className="text-xs tracking-widest uppercase text-white/60">Attack Target</span>
                </button>
              </div>
            </>
          )}

          {/* Phase Overlay */}
          {phase === 'QUIZ' && (
             <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                <div className="text-center animate-bounce">
                   <h5 className="text-6xl font-black italic text-amber-500 drop-shadow-2xl mb-4">QUIZ PHASE</h5>
                   <p className="text-white/60 font-black tracking-widest">문제풀이 담당자가 지혜를 발휘하고 있습니다...</p>
                </div>
             </div>
          )}
        </div>

        {/* Action Panel */}
        <div className="w-full md:w-[450px] bg-slate-900/95 border-l border-white/10 p-10 flex flex-col gap-10 order-2 md:order-none shadow-[-20px_0_60px_rgba(0,0,0,0.6)] backdrop-blur-3xl">
           <header className="flex justify-between items-start">
             <div>
               <h3 className="text-xs text-blue-500 font-black tracking-[0.3em] uppercase mb-1">Character Role</h3>
               <div className="text-4xl font-black italic text-white uppercase tracking-tighter">
                 {myPlayer.role === Role.QUIZ ? '🧠 Brain' : myPlayer.role === Role.SUPPORT ? '🛡️ Support' : '⚔️ Ace'}
               </div>
             </div>
             <div className="text-right">
                <p className="text-[10px] text-slate-500 font-black uppercase mb-1">My Team</p>
                <p className="text-xl font-black italic">{team.name}</p>
             </div>
           </header>

           <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
             {myPlayer.role === Role.QUIZ && (
               <div className="space-y-8 animate-in slide-in-from-right duration-500">
                  <div className={`p-8 bg-slate-800/50 rounded-[2.5rem] border transition-all ${phase === 'QUIZ' ? 'border-blue-500/30' : 'border-white/5 opacity-50 grayscale'}`}>
                    <h4 className="text-2xl font-black mb-8 leading-tight">Q. {currentQuiz.question}</h4>
                    <div className="space-y-3">
                      {currentQuiz.options.map((opt, i) => opt && (
                        <button 
                          key={i} 
                          disabled={phase !== 'QUIZ'}
                          onClick={() => handleQuizAnswer(i === currentQuiz.answer)} 
                          className="w-full p-6 bg-slate-700/50 hover:bg-blue-600 rounded-2xl text-left font-bold transition-all border border-white/5 disabled:pointer-events-none"
                        >
                          <span className="inline-block w-8 text-blue-400">{i+1}</span> {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  {phase === 'BATTLE' && (
                    <div className="bg-blue-900/20 p-8 rounded-[2rem] border border-blue-500/20 text-center space-y-4">
                      <p className="text-blue-300 font-black italic">전투 관전 중...</p>
                      <p className="text-xs text-slate-500 font-bold leading-relaxed">아군 전투요원의 움직임을 보며 전략을 조언해주세요! 서포터들이 전투요원을 강화하고 있습니다.</p>
                    </div>
                  )}
               </div>
             )}

             {myPlayer.role === Role.SUPPORT && (
               <div className="space-y-6 animate-in slide-in-from-right duration-500">
                  <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex justify-between">
                    <span>Tactical Support List</span>
                    <span className="text-amber-500">포인트 누적 중</span>
                  </div>
                  
                  <div className="space-y-3">
                    <button onClick={() => {
                      if(team.points < 10) return alert("포인트 부족!");
                      const updatedTeams = { ...gameState.teams };
                      updatedTeams[myPlayer.teamId].stats.atk += 8;
                      updatedTeams[myPlayer.teamId].points -= 10;
                      socket.emit('stateChange', { teams: updatedTeams });
                    }} className="w-full p-6 bg-red-900/10 border border-red-500/20 rounded-[2rem] flex justify-between items-center group hover:bg-red-600 transition-all shadow-xl">
                      <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-red-500/20 rounded-2xl flex items-center justify-center text-3xl shadow-inner border border-red-500/20">⚔️</div>
                        <div className="text-left">
                          <div className="font-black text-xl text-red-100 group-hover:text-white">공격력 증폭</div>
                          <div className="text-[10px] text-red-400 group-hover:text-red-100 font-black uppercase mt-1">ATK BOOST (+8)</div>
                        </div>
                      </div>
                      <span className="text-xl font-black text-slate-500 group-hover:text-white">10P</span>
                    </button>

                    <button onClick={() => {
                      if(team.points < 10) return alert("포인트 부족!");
                      const updatedTeams = { ...gameState.teams };
                      updatedTeams[myPlayer.teamId].hp = Math.min(team.maxHp, team.hp + 60);
                      updatedTeams[myPlayer.teamId].points -= 10;
                      socket.emit('stateChange', { teams: updatedTeams });
                    }} className="w-full p-6 bg-emerald-900/10 border border-emerald-500/20 rounded-[2rem] flex justify-between items-center group hover:bg-emerald-600 transition-all shadow-xl">
                      <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-3xl shadow-inner border border-emerald-500/20">❤️</div>
                        <div className="text-left">
                          <div className="font-black text-xl text-emerald-100 group-hover:text-white">긴급 체력 회복</div>
                          <div className="text-[10px] text-emerald-400 group-hover:text-emerald-100 font-black uppercase mt-1">QUICK REPAIR (+60)</div>
                        </div>
                      </div>
                      <span className="text-xl font-black text-slate-500 group-hover:text-white">10P</span>
                    </button>

                    <button onClick={() => {
                      if(team.points < 15) return alert("포인트 부족!");
                      const updatedTeams = { ...gameState.teams };
                      updatedTeams[myPlayer.teamId].stats.def += 10;
                      updatedTeams[myPlayer.teamId].points -= 15;
                      socket.emit('stateChange', { teams: updatedTeams });
                    }} className="w-full p-6 bg-blue-900/10 border border-blue-500/20 rounded-[2rem] flex justify-between items-center group hover:bg-blue-600 transition-all shadow-xl">
                      <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-blue-500/20 rounded-2xl flex items-center justify-center text-3xl shadow-inner border border-blue-500/20">🛡️</div>
                        <div className="text-left">
                          <div className="font-black text-xl text-blue-100 group-hover:text-white">방어막 전개</div>
                          <div className="text-[10px] text-blue-400 group-hover:text-blue-100 font-black uppercase mt-1">DEFENSE FIELD (+10)</div>
                        </div>
                      </div>
                      <span className="text-xl font-black text-slate-500 group-hover:text-white">15P</span>
                    </button>
                    
                    <button onClick={() => {
                      if(team.points < 20) return alert("포인트 부족!");
                      const updatedTeams = { ...gameState.teams };
                      updatedTeams[myPlayer.teamId].stats.range += 50;
                      updatedTeams[myPlayer.teamId].points -= 20;
                      socket.emit('stateChange', { teams: updatedTeams });
                    }} className="w-full p-6 bg-amber-900/10 border border-amber-500/20 rounded-[2rem] flex justify-between items-center group hover:bg-amber-600 transition-all shadow-xl">
                      <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-amber-500/20 rounded-2xl flex items-center justify-center text-3xl shadow-inner border border-amber-500/20">🎯</div>
                        <div className="text-left">
                          <div className="font-black text-xl text-amber-100 group-hover:text-white">공격 사거리 연장</div>
                          <div className="text-[10px] text-amber-400 group-hover:text-amber-100 font-black uppercase mt-1">RANGE UP (+50)</div>
                        </div>
                      </div>
                      <span className="text-xl font-black text-slate-500 group-hover:text-white">20P</span>
                    </button>
                  </div>
                  
                  <div className="bg-slate-800/50 p-6 rounded-3xl border border-white/5 text-[11px] font-bold text-slate-500 leading-relaxed italic">
                     * 서포터는 두 명까지 가능하며 같은 팀 포인트를 공유합니다.
                     실시간으로 전투요원을 강화하여 전황을 유리하게 만드세요!
                  </div>
               </div>
             )}

             {myPlayer.role === Role.COMBAT && (
               <div className="flex-1 flex flex-col gap-8 animate-in zoom-in duration-500">
                  <div className="p-12 bg-gradient-to-br from-slate-800 to-slate-950 rounded-[4rem] border-2 border-white/5 flex flex-col items-center justify-center shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-500 shadow-[0_0_25px_rgba(59,130,246,0.8)]"></div>
                    <div className="w-48 h-48 bg-white/5 rounded-full flex items-center justify-center text-[10rem] mb-8 shadow-inner border border-white/5 group-hover:scale-110 transition-transform">
                       {team.classType === ClassType.WARRIOR ? '🛡️' : team.classType === ClassType.MAGE ? '🔮' : team.classType === ClassType.ARCHER ? '🏹' : '🗡️'}
                    </div>
                    <h4 className="text-5xl font-black italic uppercase tracking-tighter mb-2 drop-shadow-lg">{team.classType}</h4>
                    <p className="text-[10px] text-blue-400 font-black tracking-[0.4em] uppercase">Battlefield Ace</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                     <div className="bg-slate-800/30 p-6 rounded-3xl border border-white/5 shadow-inner">
                        <div className="text-[10px] text-slate-500 font-black mb-1 uppercase tracking-widest">Attack Power</div>
                        <div className="text-3xl font-black italic text-red-500">{team.stats.atk}</div>
                     </div>
                     <div className="bg-slate-800/30 p-6 rounded-3xl border border-white/5 shadow-inner">
                        <div className="text-[10px] text-slate-500 font-black mb-1 uppercase tracking-widest">Defense</div>
                        <div className="text-3xl font-black italic text-blue-500">{team.stats.def}</div>
                     </div>
                     <div className="bg-slate-800/30 p-6 rounded-3xl border border-white/5 shadow-inner col-span-2">
                        <div className="text-[10px] text-slate-500 font-black mb-1 uppercase tracking-widest">Attack Range</div>
                        <div className="text-3xl font-black italic text-amber-500">{team.stats.range} <span className="text-xs not-italic opacity-50">Units</span></div>
                     </div>
                  </div>
               </div>
             )}
           </div>

           <footer className="pt-8 border-t border-white/5 flex justify-between items-center">
              <span className="text-[10px] text-slate-600 font-black tracking-widest uppercase italic">EDU-ARENA PROTOCOL v4.5</span>
              <div className="flex gap-1">
                 <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                 <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse delay-100"></div>
              </div>
           </footer>
        </div>
      </div>
    );
  }

  return null;
};

export default App;
