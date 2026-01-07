
import React, { useState, useEffect, useRef } from 'react';
import { socket } from './services/mockSocket';
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

  // CSV Parsing
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

    // 중복 체크 (안전 장치)
    const players = Object.values(gameState.players);
    if (role === Role.QUIZ && players.some(p => p.teamId === teamId && p.role === Role.QUIZ)) return alert("이미 자리가 찼습니다.");
    if (role === Role.COMBAT && players.some(p => p.teamId === teamId && p.role === Role.COMBAT)) return alert("이미 자리가 찼습니다.");
    if (role === Role.SUPPORT && players.filter(p => p.teamId === teamId && p.role === Role.SUPPORT).length >= 2) return alert("이미 자리가 찼습니다.");

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
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#020617] text-white bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
        <div className="text-center mb-12 animate-pulse">
          <h1 className="text-8xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-blue-300 via-white to-blue-600 drop-shadow-2xl">EDU ARENA</h1>
          <p className="text-blue-400 font-bold tracking-[0.5em] mt-4 uppercase">Fantasy Battle Royale</p>
        </div>
        <div className="w-full max-w-md p-10 bg-slate-900/80 backdrop-blur-xl rounded-[3rem] border-2 border-blue-500/30 shadow-[0_0_50px_rgba(59,130,246,0.2)] space-y-8">
          <div className="space-y-4">
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 font-bold" placeholder="영웅 닉네임" value={userName} onChange={e => setUserName(e.target.value)} />
            <input className="w-full p-5 bg-slate-800 border border-slate-700 rounded-2xl text-white outline-none focus:ring-2 ring-blue-500 uppercase font-black" placeholder="방 코드" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
            <button onClick={() => roomCode ? setView('lobby') : alert("코드를 입력하세요")} className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-2xl shadow-lg transition-transform active:scale-95">입장하기</button>
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
            <div className="bg-slate-900 p-8 rounded-[3rem] border border-blue-500/20 shadow-2xl space-y-4">
              <h3 className="text-xl font-black mb-6">1. 퀴즈 직접 입력</h3>
              <input className="w-full p-4 bg-black/50 border border-white/5 rounded-xl font-bold" placeholder="질문" value={newQuiz.question} onChange={e => setNewQuiz({...newQuiz, question: e.target.value})} />
              <div className="grid grid-cols-2 gap-3">
                {newQuiz.options.map((opt, i) => (
                  <input key={i} className="p-3 bg-black/50 border border-white/5 rounded-xl text-sm" placeholder={`보기 ${i+1}`} value={opt} onChange={e => {
                    const opts = [...newQuiz.options];
                    opts[i] = e.target.value;
                    setNewQuiz({...newQuiz, options: opts});
                  }} />
                ))}
              </div>
              <button onClick={() => { if(newQuiz.question) { setQuizList([...quizList, newQuiz]); setNewQuiz({question:'', options:['','','',''], answer:0}); } }} className="w-full py-4 bg-blue-600 rounded-2xl font-black">추가</button>
            </div>
            <div className="bg-slate-900 p-8 rounded-[3rem] border border-emerald-500/20 shadow-2xl space-y-4">
              <h3 className="text-xl font-black">2. 엑셀(CSV) 업로드</h3>
              <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleFileUpload} />
              <button onClick={() => fileInputRef.current?.click()} className="w-full py-4 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-2xl font-bold">파일 선택</button>
              <button onClick={() => {
                const blob = new Blob(["\ufeff문제,보기1,보기2,보기3,보기4,정답(1-4)\n사과는 영어로?,Apple,Banana,Grape,Peach,1"], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.setAttribute("download", "quiz_template.csv");
                link.click();
              }} className="w-full text-center text-xs text-slate-500 underline">샘플 양식 다운로드</button>
            </div>
          </div>
          <div className="col-span-7 space-y-8">
            <div className="bg-slate-950 p-8 rounded-[3rem] border border-white/5 h-[450px] overflow-y-auto custom-scrollbar shadow-inner">
               <h3 className="text-xl font-black mb-6">퀴즈 리스트 ({quizList.length})</h3>
               {quizList.map((q, i) => (
                 <div key={i} className="p-5 bg-white/5 rounded-2xl mb-3 flex justify-between items-center border border-white/5">
                   <span className="font-bold">{i+1}. {q.question}</span>
                   <button onClick={() => setQuizList(quizList.filter((_, idx) => idx !== i))} className="text-red-500 font-black text-sm">삭제</button>
                 </div>
               ))}
            </div>
            <button onClick={createRoom} className="w-full py-6 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-3xl shadow-xl transition-all active:scale-95">방 생성 및 학생 대기</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'host_lobby') {
    const players = Object.values(gameState.players);
    return (
      <div className="h-screen bg-[#020617] text-white flex flex-col p-10">
        <header className="flex justify-between items-center mb-8 bg-slate-900/50 p-8 rounded-[3rem] border border-white/5 shadow-2xl">
          <div>
            <p className="text-blue-500 font-black text-xs tracking-widest uppercase mb-1">Entrance Code</p>
            <h2 className="text-7xl font-mono font-black">{gameState.roomCode}</h2>
          </div>
          <button onClick={() => socket.emit('stateChange', { isStarted: true })} className="px-16 py-8 bg-emerald-600 hover:bg-emerald-500 rounded-3xl font-black text-4xl shadow-2xl">게임 시작</button>
        </header>
        
        <div className="flex-1 grid grid-cols-3 gap-8 overflow-y-auto custom-scrollbar">
          {[1,2,3,4,5,6,7,8,9].map(tId => {
            const teamPlayers = players.filter(p => p.teamId === tId.toString());
            return (
              <div key={tId} className="bg-slate-900/80 p-6 rounded-[2.5rem] border border-white/10 space-y-4 shadow-xl">
                <h3 className="text-2xl font-black italic border-b border-white/10 pb-2">{tId} 모둠</h3>
                <div className="space-y-2">
                  <div className={`p-2 rounded-xl flex justify-between items-center text-xs font-bold ${teamPlayers.some(p => p.role === Role.QUIZ) ? 'bg-blue-600/20 text-blue-400' : 'bg-white/5 text-slate-600'}`}>
                    <span>🧠 문제풀이</span>
                    <span>{teamPlayers.find(p => p.role === Role.QUIZ)?.name || '비어있음'}</span>
                  </div>
                  <div className={`p-2 rounded-xl flex justify-between items-center text-xs font-bold ${teamPlayers.filter(p => p.role === Role.SUPPORT).length > 0 ? 'bg-emerald-600/20 text-emerald-400' : 'bg-white/5 text-slate-600'}`}>
                    <span>🛡️ 서포터 ({teamPlayers.filter(p => p.role === Role.SUPPORT).length}/2)</span>
                    <span className="truncate max-w-[100px]">{teamPlayers.filter(p => p.role === Role.SUPPORT).map(p => p.name).join(', ') || '비어있음'}</span>
                  </div>
                  <div className={`p-2 rounded-xl flex justify-between items-center text-xs font-bold ${teamPlayers.some(p => p.role === Role.COMBAT) ? 'bg-red-600/20 text-red-400' : 'bg-white/5 text-slate-600'}`}>
                    <span>⚔️ 전투요원</span>
                    <span>{teamPlayers.find(p => p.role === Role.COMBAT)?.name || '비어있음'}</span>
                  </div>
                </div>
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
      <div className="h-screen bg-[#020617] text-white flex flex-col p-6 overflow-hidden">
        <h2 className="text-5xl font-black italic text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-white">모둠 및 역할 선택</h2>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pb-32">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-7xl mx-auto">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tId => {
              const teamPlayers = players.filter(p => p.teamId === tId.toString());
              const quizTaken = teamPlayers.some(p => p.role === Role.QUIZ);
              const combatTaken = teamPlayers.some(p => p.role === Role.COMBAT);
              const supporters = teamPlayers.filter(p => p.role === Role.SUPPORT).length;
              
              const isMyTeam = myPlayer?.teamId === tId.toString();

              return (
                <div key={tId} className={`p-8 rounded-[3rem] border-2 transition-all ${isMyTeam ? 'bg-blue-600/20 border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.3)]' : 'bg-slate-900 border-white/5'}`}>
                  <h3 className="text-3xl font-black mb-6 italic">{tId} Team</h3>
                  <div className="space-y-3">
                    <button 
                      disabled={quizTaken || !!myPlayer}
                      onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.QUIZ })}
                      className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.QUIZ ? 'ring-2 ring-white bg-blue-600' : quizTaken ? 'bg-slate-800 opacity-40 grayscale' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                      <span>🧠 문제풀이</span>
                      <span className="text-xs uppercase">{quizTaken ? '선택 완료' : '선택 가능'}</span>
                    </button>
                    
                    <button 
                      disabled={supporters >= 2 || !!myPlayer}
                      onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.SUPPORT })}
                      className={`w-full p-4 rounded-2xl text-left font-black flex justify-between transition-all ${pendingSelection?.teamId === tId.toString() && pendingSelection?.role === Role.SUPPORT ? 'ring-2 ring-white bg-emerald-600' : supporters >= 2 ? 'bg-slate-800 opacity-40 grayscale' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                      <span>🛡️ 서포터 ({supporters}/2)</span>
                      <span className="text-xs uppercase">{supporters >= 2 ? '선택 완료' : '선택 가능'}</span>
                    </button>

                    <div className="pt-4 border-t border-white/10 mt-2">
                      <p className="text-[10px] font-black text-slate-500 uppercase mb-3 tracking-widest">전투요원 클래스</p>
                      <div className="grid grid-cols-2 gap-3">
                        {[ClassType.WARRIOR, ClassType.MAGE, ClassType.ARCHER, ClassType.ROGUE].map(ct => {
                          const isPending = pendingSelection?.teamId === tId.toString() && pendingSelection?.classType === ct;
                          return (
                            <button 
                              key={ct}
                              disabled={combatTaken || !!myPlayer}
                              onClick={() => setPendingSelection({ teamId: tId.toString(), role: Role.COMBAT, classType: ct })}
                              className={`p-3 rounded-xl text-xs font-black transition-all ${isPending ? 'ring-2 ring-white bg-red-600' : combatTaken ? 'bg-slate-950 opacity-40 grayscale' : 'bg-slate-950 hover:bg-slate-800'}`}
                            >
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
          <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#020617] via-[#020617]/90 to-transparent flex justify-center">
            <button 
              disabled={!pendingSelection}
              onClick={confirmSelection}
              className={`w-full max-w-md py-6 rounded-[2rem] font-black text-3xl shadow-2xl transition-all ${pendingSelection ? 'bg-blue-600 animate-bounce cursor-pointer' : 'bg-slate-800 opacity-50 grayscale cursor-not-allowed'}`}
            >
              확정 선택 완료
            </button>
          </div>
        )}
        {myPlayer && <div className="fixed bottom-12 left-0 right-0 text-center font-black text-blue-400 animate-pulse text-xl">다른 모험가들을 기다리는 중...</div>}
      </div>
    );
  }

  if (view === 'game' && myPlayer) {
    const team = gameState.teams[myPlayer.teamId];
    if (!team) return <div className="h-screen bg-black flex items-center justify-center font-black">동기화 중...</div>;
    const currentQuizIdx = gameState.currentQuizIndex || 0;
    const currentQuiz = gameState.quizzes[currentQuizIdx] || { question: "준비된 퀴즈가 종료되었습니다.", options: ["교사를 기다리세요", "", "", ""], answer: 0 };
    const phase = gameState.phase || 'QUIZ';

    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col md:flex-row overflow-hidden select-none">
        <div className="flex-1 relative order-1 md:order-none">
          <GameCanvas teams={gameState.teams} myTeamId={myPlayer.teamId} />
          
          <div className="absolute top-8 left-8 flex gap-6 pointer-events-none">
            <div className="bg-slate-900/90 p-6 rounded-[2rem] border border-white/10 pointer-events-auto shadow-2xl">
              <div className="flex items-center gap-4">
                <div className="text-center">
                   <p className="text-[10px] text-blue-400 font-black uppercase mb-1">{team.name}</p>
                   <h4 className="text-2xl font-black italic">{team.hp > 0 ? '전투 중' : '탈락'}</h4>
                </div>
                <div className="w-32 h-3 bg-black rounded-full border border-white/5 overflow-hidden">
                  <div className="h-full bg-red-600 transition-all duration-500" style={{ width: `${(team.hp/team.maxHp)*100}%` }} />
                </div>
              </div>
            </div>
            <div className="bg-amber-500 px-8 py-5 rounded-[2rem] text-black font-black text-3xl italic pointer-events-auto shadow-2xl">{team.points} P</div>
          </div>

          {myPlayer.role === Role.COMBAT && phase === 'BATTLE' && !team.isDead && (
            <>
              <div className="absolute bottom-12 left-12 scale-125 origin-bottom-left"><Joystick onMove={movePlayer} /></div>
              <div className="absolute bottom-16 right-16">
                <button onClick={attack} className="w-32 h-32 bg-red-600 rounded-full shadow-[0_0_50px_rgba(220,38,38,0.5)] border-4 border-white/20 active:scale-90 font-black text-5xl">⚔️</button>
              </div>
            </>
          )}
          
          {phase === 'QUIZ' && <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-none text-5xl font-black italic text-amber-500 animate-pulse tracking-widest">QUIZ PHASE</div>}
        </div>

        <div className="w-full md:w-96 bg-slate-900/95 border-l border-white/10 p-10 flex flex-col gap-10 order-2 md:order-none shadow-2xl backdrop-blur-xl">
           <header><p className="text-xs text-blue-500 font-black tracking-widest uppercase mb-1">{myPlayer.role}</p><h3 className="text-4xl font-black italic">{team.name}</h3></header>
           
           <div className="flex-1 overflow-y-auto custom-scrollbar">
             {myPlayer.role === Role.QUIZ && phase === 'QUIZ' && (
                <div className="p-8 bg-slate-800/50 rounded-[2.5rem] border border-blue-500/30 space-y-6">
                  <h4 className="text-xl font-bold leading-tight">Q. {currentQuiz.question}</h4>
                  <div className="space-y-3">
                    {currentQuiz.options.map((opt, i) => opt && (
                      <button key={i} onClick={() => handleQuizAnswer(i === currentQuiz.answer)} className="w-full p-5 bg-slate-700/50 hover:bg-blue-600 rounded-2xl text-left font-black transition-all border border-white/5">{i+1}. {opt}</button>
                    ))}
                  </div>
                </div>
             )}

             {myPlayer.role === Role.SUPPORT && (
               <div className="space-y-4">
                  <button onClick={() => {
                    if(team.points >= 10) {
                      const ut = { ...gameState.teams };
                      ut[myPlayer.teamId].stats.atk += 10;
                      ut[myPlayer.teamId].points -= 10;
                      socket.emit('stateChange', { teams: ut });
                    } else alert("포인트 부족!");
                  }} className="w-full p-6 bg-red-900/20 border border-red-500/20 rounded-[2rem] flex justify-between items-center group hover:bg-red-600 transition-all">
                    <div className="flex items-center gap-4 text-left"><span className="text-3xl">⚔️</span><div><div className="font-black text-xl">공격력 강화</div></div></div>
                    <span className="font-black">10P</span>
                  </button>
                  <button onClick={() => {
                    if(team.points >= 10) {
                      const ut = { ...gameState.teams };
                      ut[myPlayer.teamId].hp = Math.min(team.maxHp, team.hp + 50);
                      ut[myPlayer.teamId].points -= 10;
                      socket.emit('stateChange', { teams: ut });
                    } else alert("포인트 부족!");
                  }} className="w-full p-6 bg-emerald-900/20 border border-emerald-500/20 rounded-[2rem] flex justify-between items-center group hover:bg-emerald-600 transition-all">
                    <div className="flex items-center gap-4 text-left"><span className="text-3xl">❤️</span><div><div className="font-black text-xl">생명력 회복</div></div></div>
                    <span className="font-black">10P</span>
                  </button>
               </div>
             )}

             {myPlayer.role === Role.COMBAT && (
               <div className="text-center p-12 bg-slate-800/40 rounded-[3rem] border border-white/5 space-y-6">
                 <div className="text-8xl">{team.classType === ClassType.WARRIOR ? '🛡️' : team.classType === ClassType.MAGE ? '🔮' : team.classType === ClassType.ARCHER ? '🏹' : '🗡️'}</div>
                 <h4 className="text-3xl font-black italic uppercase tracking-tighter">{team.classType}</h4>
                 <div className="flex justify-center gap-4 text-xs font-bold text-slate-500">
                    <span>ATK {team.stats.atk}</span>
                    <span>DEF {team.stats.def}</span>
                 </div>
               </div>
             )}
           </div>
           
           <footer className="pt-6 border-t border-white/5 text-[10px] text-slate-500 font-black tracking-widest uppercase italic">
              Energy Status: Stable
           </footer>
        </div>
      </div>
    );
  }

  return null;
};

export default App;
