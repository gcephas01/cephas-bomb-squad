"use client";

import { useEffect, useRef, useState } from "react";

/* =========================================================
   TYPES
========================================================= */

type Team = {
  id: number;
  name: string;
  score: number;
  roundPoints: number;
};

type WireType = "defuse" | "detonator" | "points" | "time";

type Wire = {
  id: number;
  color: string;
  darkColor: string;
  colorName: string;
  type: WireType;
  value: number;
  cut: boolean;
};

type GameStatus =
  | "setup"
  | "ready"
  | "running"
  | "paused"
  | "defused"
  | "exploded"
  | "between"
  | "ended";

type RevealState = {
  phase: "idle" | "analyzing" | "result";
  title: string;
  subtitle: string;
  tone: "neutral" | "good" | "bad" | "danger";
};

type MissionLogEntry = {
  id: number;
  round: number;
  text: string;
};

type UndoSnapshot = {
  teams: Team[];
  wires: Wire[];
  activeTeamId: number | null;
  message: string;
  reveal: RevealState;
};

/* =========================================================
   CONSTANTS
========================================================= */

const WIRE_COLORS = [
  { name: "RED", color: "#ef4444", darkColor: "#7f1d1d" },
  { name: "BLUE", color: "#3b82f6", darkColor: "#1e3a8a" },
  { name: "YELLOW", color: "#facc15", darkColor: "#854d0e" },
  { name: "GREEN", color: "#22c55e", darkColor: "#14532d" },
  { name: "PURPLE", color: "#a855f7", darkColor: "#581c87" },
  { name: "WHITE", color: "#f8fafc", darkColor: "#64748b" },
];

const POINT_VALUES = [250, 500, 750, 1000, 1250, 1500];

const DEFAULT_REVEAL: RevealState = {
  phase: "idle",
  title: "",
  subtitle: "",
  tone: "neutral",
};

/* =========================================================
   HELPERS
========================================================= */

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0"
  )}`;
}

function cloneTeams(teams: Team[]) {
  return teams.map((team) => ({ ...team }));
}

function cloneWires(wires: Wire[]) {
  return wires.map((wire) => ({ ...wire }));
}

/* =========================================================
   ROUND DIFFICULTY
========================================================= */

function getNegativeTimeValues(round: number) {
  if (round <= 1) return [-5, -10, -15, -20];
  if (round === 2) return [-5, -10, -15, -20, -25];

  return [-5, -10, -15, -20, -25, -30];
}

function getPointValues(round: number) {
  if (round <= 1) return [250, 500, 750, 1000];
  if (round === 2) return [250, 500, 750, 1000, 1250];

  return POINT_VALUES;
}

function createRandomEffect(round: number): {
  type: "points" | "time";
  value: number;
} {
  // 60% chance of a points wire.
  const isPoints = Math.random() < 0.6;

  if (isPoints) {
    return {
      type: "points",
      value: randomFrom(getPointValues(round)),
    };
  }

  // Time effects can help or hurt.
  // Positive time NEVER exceeds +15.
  const positiveTime = Math.random() < 0.42;

  if (positiveTime) {
    return {
      type: "time",
      value: randomFrom([5, 10, 15]),
    };
  }

  return {
    type: "time",
    value: randomFrom(getNegativeTimeValues(round)),
  };
}

function createWires(round: number): Wire[] {
  const effects = Array.from({ length: 4 }, () =>
    createRandomEffect(round)
  );

  const payloads: Array<{
    type: WireType;
    value: number;
  }> = shuffle([
    { type: "defuse", value: 0 },
    { type: "detonator", value: 0 },
    ...effects,
  ]);

  return WIRE_COLORS.map((wire, index) => ({
    id: index,
    color: wire.color,
    darkColor: wire.darkColor,
    colorName: wire.name,
    type: payloads[index].type,
    value: payloads[index].value,
    cut: false,
  }));
}

/* =========================================================
   COMPONENT
========================================================= */

export default function Home() {
  /* ---------- SETUP ---------- */

  const [teamCount, setTeamCount] = useState(4);
  const [startingTime, setStartingTime] = useState(120);
  const [nextMissionTime, setNextMissionTime] = useState(120);

  /* ---------- GAME ---------- */

  const [teams, setTeams] = useState<Team[]>([]);
  const [wires, setWires] = useState<Wire[]>([]);

  const [timeLeft, setTimeLeft] = useState(120);
  const [status, setStatus] = useState<GameStatus>("setup");

  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  const [round, setRound] = useState(1);

  const [message, setMessage] = useState(
    "Answer fast. Cut carefully. Save everybody."
  );

  /* ---------- PRESENTATION ---------- */

  const [soundOn, setSoundOn] = useState(true);
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState(false);

  const [reveal, setReveal] =
    useState<RevealState>(DEFAULT_REVEAL);

  /* ---------- UTILITIES ---------- */

  const [missionLog, setMissionLog] = useState<MissionLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showTeacherTools, setShowTeacherTools] = useState(false);

  const [undoSnapshot, setUndoSnapshot] =
    useState<UndoSnapshot | null>(null);

  /* ---------- REFS ---------- */

  const intervalRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);

  const revealTimeoutsRef =
    useRef<ReturnType<typeof setTimeout>[]>([]);

  const logIdRef = useRef(1);

  /* =========================================================
     DERIVED STATE
  ========================================================= */

  const remainingWires = wires.filter((wire) => !wire.cut);

  const isCritical =
    status === "running" && timeLeft <= 10;

  const isWarning =
    status === "running" &&
    timeLeft <= 30 &&
    timeLeft > 10;

  const sortedTeams = [...teams].sort(
    (a, b) => b.score - a.score
  );

  const highestScore =
    sortedTeams.length > 0 ? sortedTeams[0].score : 0;

  const winners = sortedTeams.filter(
    (team) => team.score === highestScore
  );

  /* =========================================================
     AUDIO ENGINE
  ========================================================= */

  function getAudioContext() {
    if (!soundOn) return null;

    if (!audioContextRef.current) {
      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextClass) return null;

      audioContextRef.current = new AudioContextClass();
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }

  function tone(
    frequency: number,
    duration: number,
    volume = 0.08,
    type: OscillatorType = "sine",
    delay = 0
  ) {
    const ctx = getAudioContext();
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    const start = ctx.currentTime + delay;
    const end = start + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      volume,
      start + 0.01
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      end
    );

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }

  function noiseBurst(
    duration = 0.4,
    volume = 0.15
  ) {
    const ctx = getAudioContext();
    if (!ctx) return;

    const bufferSize = Math.floor(
      ctx.sampleRate * duration
    );

    const buffer = ctx.createBuffer(
      1,
      bufferSize,
      ctx.sampleRate
    );

    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = "lowpass";
    filter.frequency.value = 700;

    source.buffer = buffer;

    gain.gain.setValueAtTime(
      volume,
      ctx.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + duration
    );

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start();
  }

  function playTick() {
    if (!soundOn) return;

    if (timeLeft <= 5) {
      tone(900, 0.12, 0.11, "square");
    } else if (timeLeft <= 10) {
      tone(720, 0.08, 0.07, "square");
    } else {
      tone(1200, 0.025, 0.025, "square");
    }
  }

  function playSnip() {
    tone(1700, 0.04, 0.08, "square");
    tone(500, 0.07, 0.06, "sawtooth", 0.04);
  }

  function playGood() {
    tone(520, 0.12, 0.08);
    tone(660, 0.12, 0.08, "sine", 0.11);
    tone(820, 0.18, 0.08, "sine", 0.22);
  }

  function playBad() {
    tone(420, 0.16, 0.08, "sawtooth");
    tone(300, 0.2, 0.09, "sawtooth", 0.12);
  }

  function playDanger() {
    tone(180, 0.15, 0.11, "sawtooth");
    tone(180, 0.15, 0.11, "sawtooth", 0.2);
    tone(130, 0.28, 0.12, "sawtooth", 0.4);
  }

  function playDefuse() {
    tone(260, 0.08, 0.07, "square");

    setTimeout(() => {
      tone(392, 0.18, 0.08);
      tone(523, 0.18, 0.09, "sine", 0.15);
      tone(659, 0.18, 0.09, "sine", 0.3);
      tone(784, 0.45, 0.1, "sine", 0.45);
    }, 550);
  }

  function playExplosion() {
    noiseBurst(0.9, 0.32);
    tone(65, 0.7, 0.2, "sawtooth");
    tone(45, 0.9, 0.18, "sine", 0.08);
  }

  /* =========================================================
     VISUAL FX
  ========================================================= */

  function triggerShake(duration = 500) {
    setShake(true);

    setTimeout(() => {
      setShake(false);
    }, duration);
  }

  function triggerFlash(duration = 160) {
    setFlash(true);

    setTimeout(() => {
      setFlash(false);
    }, duration);
  }

  /* =========================================================
     LOG / UNDO
  ========================================================= */

  function addLog(text: string) {
    setMissionLog((current) => [
      {
        id: logIdRef.current++,
        round,
        text,
      },
      ...current,
    ]);
  }

  function createUndoSnapshot() {
    setUndoSnapshot({
      teams: cloneTeams(teams),
      wires: cloneWires(wires),
      activeTeamId,
      message,
      reveal: { ...reveal },
    });
  }

  function undoLastAction() {
    if (!undoSnapshot) return;
    if (
      status !== "running" &&
      status !== "paused"
    )
      return;

    clearRevealTimers();

    setTeams(cloneTeams(undoSnapshot.teams));
    setWires(cloneWires(undoSnapshot.wires));
    setActiveTeamId(undoSnapshot.activeTeamId);
    setMessage(undoSnapshot.message);
    setReveal({ ...undoSnapshot.reveal });

    setUndoSnapshot(null);

    addLog(
      "TEACHER UNDO — previous action reversed. Clock was not refunded."
    );
  }

  /* =========================================================
     TIMER
  ========================================================= */

  useEffect(() => {
    if (status !== "running") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      return;
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) return 0;
        return current - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status]);

  useEffect(() => {
    if (status === "running") {
      playTick();

      if (timeLeft <= 10 && timeLeft > 0) {
        triggerShake(120);
      }
    }

    if (timeLeft === 0 && status === "running") {
      explodeBomb("TIME EXPIRED");
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, status]);

  /* =========================================================
     CLEANUP
  ========================================================= */

  function clearRevealTimers() {
    revealTimeoutsRef.current.forEach(clearTimeout);
    revealTimeoutsRef.current = [];
  }

  useEffect(() => {
    return () => {
      clearRevealTimers();

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  /* =========================================================
     GAME SETUP
  ========================================================= */

  function setupGame() {
    clearRevealTimers();

    const newTeams: Team[] = Array.from(
      { length: teamCount },
      (_, index) => ({
        id: index + 1,
        name: `TEAM ${index + 1}`,
        score: 0,
        roundPoints: 0,
      })
    );

    setTeams(newTeams);
    setWires(createWires(1));
    setTimeLeft(startingTime);
    setNextMissionTime(startingTime);
    setRound(1);

    setActiveTeamId(null);
    setReveal(DEFAULT_REVEAL);

    setMissionLog([]);
    setUndoSnapshot(null);

    setMessage(
      "Bomb armed. Start the timer when the class is ready."
    );

    setStatus("ready");
  }

  function startBomb() {
    getAudioContext();

    setStatus("running");
    setMessage("THE CLOCK IS LIVE.");
    setReveal(DEFAULT_REVEAL);

    addLog(
      `MISSION ${round} STARTED — ${formatTime(
        timeLeft
      )} on the clock.`
    );
  }

  /* =========================================================
     PAUSE
  ========================================================= */

  function pauseBomb() {
    if (status === "running") {
      clearRevealTimers();

      // If a reveal was in progress, return control safely.
      if (reveal.phase !== "idle") {
        setReveal(DEFAULT_REVEAL);
        setActiveTeamId(null);
      }

      setStatus("paused");
      setMessage("MISSION PAUSED — CLASSROOM HOLD");

      return;
    }

    if (status === "paused") {
      setStatus("running");
      setMessage("THE CLOCK IS LIVE.");
    }
  }

  /* =========================================================
     QUESTION / TEAM AUTHORIZATION
  ========================================================= */

  function markTeamCorrect(teamId: number) {
    if (status !== "running") return;
    if (reveal.phase !== "idle") return;
    if (activeTeamId !== null) return;

    createUndoSnapshot();

    const team = teams.find(
      (item) => item.id === teamId
    );

    setActiveTeamId(teamId);

    setMessage(
      `${team?.name ?? "TEAM"} — SELECT A WIRE.`
    );

    addLog(
      `${team?.name ?? "TEAM"} answered correctly and earned a wire cut.`
    );
  }

  /* =========================================================
     SCORING / TIME
  ========================================================= */

  function addRoundPoints(
    teamId: number,
    points: number
  ) {
    setTeams((current) =>
      current.map((team) =>
        team.id === teamId
          ? {
              ...team,
              roundPoints:
                team.roundPoints + points,
            }
          : team
      )
    );
  }

  function addTime(seconds: number) {
    setTimeLeft((current) =>
      Math.max(0, current + seconds)
    );
  }

  function adjustScore(
    teamId: number,
    amount: number
  ) {
    setTeams((current) =>
      current.map((team) =>
        team.id === teamId
          ? {
              ...team,
              score: Math.max(
                0,
                team.score + amount
              ),
            }
          : team
      )
    );
  }

  /* =========================================================
     REVEAL ENGINE
  ========================================================= */

  function finishNormalReveal(
    title: string,
    subtitle: string,
    toneValue: RevealState["tone"],
    sound: "good" | "bad" | "danger" | "none"
  ) {
    const analyzeTimer = setTimeout(() => {
      setReveal({
        phase: "result",
        title,
        subtitle,
        tone: toneValue,
      });

      if (sound === "good") playGood();
      if (sound === "bad") playBad();
      if (sound === "danger") playDanger();

      const resultTimer = setTimeout(() => {
        setReveal(DEFAULT_REVEAL);
        setActiveTeamId(null);
        setMessage("NEXT QUESTION.");
      }, 1350);

      revealTimeoutsRef.current.push(resultTimer);
    }, 650);

    revealTimeoutsRef.current.push(analyzeTimer);
  }

  /* =========================================================
     CUT WIRE
  ========================================================= */

  function cutWire(wireId: number) {
    if (status !== "running") return;
    if (activeTeamId === null) return;
    if (reveal.phase !== "idle") return;

    const wire = wires.find(
      (item) => item.id === wireId
    );

    if (!wire || wire.cut) return;

    createUndoSnapshot();

    const teamId = activeTeamId;

    const team = teams.find(
      (item) => item.id === teamId
    );

    const teamName =
      team?.name ?? "TEAM";

    const wiresBeforeCut = wires.filter(
      (item) => !item.cut
    ).length;

    setWires((current) =>
      current.map((item) =>
        item.id === wireId
          ? { ...item, cut: true }
          : item
      )
    );

    playSnip();
    triggerFlash(100);

    setReveal({
      phase: "analyzing",
      title: "ANALYZING WIRE...",
      subtitle: `${wire.colorName} CIRCUIT`,
      tone: "neutral",
    });

    setMessage("DO NOT TOUCH ANOTHER WIRE.");

    /* ---------- DEFUSE ---------- */

    if (wire.type === "defuse") {
      addLog(
        `${teamName} cut ${wire.colorName} — DEFUSE WIRE.`
      );

      const timer = setTimeout(() => {
        setReveal({
          phase: "result",
          title: "DEFUSE WIRE",
          subtitle: "CIRCUIT NEUTRALIZED",
          tone: "good",
        });

        playDefuse();

        const finalTimer = setTimeout(() => {
          defuseBomb(teamId, teamName);
        }, 900);

        revealTimeoutsRef.current.push(
          finalTimer
        );
      }, 650);

      revealTimeoutsRef.current.push(timer);
      return;
    }

    /* ---------- DETONATOR ---------- */

    if (wire.type === "detonator") {
      const timer = setTimeout(() => {
        if (wiresBeforeCut >= 3) {
          addLog(
            `${teamName} cut ${wire.colorName} — DETONATOR.`
          );

          setReveal({
            phase: "result",
            title: "DETONATOR WIRE",
            subtitle: "CRITICAL FAILURE",
            tone: "danger",
          });

          playDanger();

          const boomTimer = setTimeout(() => {
            explodeBomb(
              `${teamName} CUT THE DETONATOR`
            );
          }, 650);

          revealTimeoutsRef.current.push(
            boomTimer
          );

          return;
        }

        addLog(
          `${teamName} cut ${wire.colorName} — DETONATOR ISOLATED SAFELY.`
        );

        setReveal({
          phase: "result",
          title: "DETONATOR WIRE",
          subtitle: "CIRCUIT ISOLATED — SAFE",
          tone: "good",
        });

        playDanger();

        const safeTimer = setTimeout(() => {
          setReveal(DEFAULT_REVEAL);
          setActiveTeamId(null);

          setMessage(
            "THE BOMB IS STILL LIVE. NEXT QUESTION."
          );
        }, 1500);

        revealTimeoutsRef.current.push(
          safeTimer
        );
      }, 650);

      revealTimeoutsRef.current.push(timer);
      return;
    }

    /* ---------- POINTS ---------- */

    if (wire.type === "points") {
      addRoundPoints(teamId, wire.value);

      addLog(
        `${teamName} cut ${wire.colorName} — +${wire.value.toLocaleString()} points.`
      );

      finishNormalReveal(
        `+${wire.value.toLocaleString()} POINTS`,
        `${teamName} ADDS TO THE POT`,
        "good",
        "good"
      );

      return;
    }

    /* ---------- TIME ---------- */

    if (wire.type === "time") {
      addTime(wire.value);

      if (wire.value > 0) {
        addLog(
          `${teamName} cut ${wire.colorName} — +${wire.value} seconds.`
        );

        finishNormalReveal(
          `+${wire.value} SECONDS`,
          `${teamName} BOUGHT THE CLASS MORE TIME`,
          "good",
          "good"
        );
      } else {
        addLog(
          `${teamName} cut ${wire.colorName} — ${wire.value} seconds.`
        );

        finishNormalReveal(
          `${wire.value} SECONDS`,
          `${teamName} JUST MADE THINGS WORSE`,
          "bad",
          "bad"
        );
      }
    }
  }

  /* =========================================================
     ROUND RESULTS
  ========================================================= */

  function defuseBomb(
    teamId: number,
    teamName: string
  ) {
    clearRevealTimers();

    setStatus("defused");
    setActiveTeamId(null);

    setTeams((current) =>
      current.map((team) => ({
        ...team,
        score:
          team.score +
          team.roundPoints +
          (team.id === teamId ? 1000 : 0),
        roundPoints: 0,
      }))
    );

    setReveal(DEFAULT_REVEAL);

    setMessage(
      `${teamName} MADE THE FINAL CUT — +1,000 DEFUSE BONUS`
    );

    addLog(
      `MISSION ${round} DEFUSED — ${teamName} earned the 1,000-point Defuse Bonus.`
    );
  }

  function explodeBomb(reason: string) {
    clearRevealTimers();

    setStatus("exploded");
    setActiveTeamId(null);

    setTeams((current) =>
      current.map((team) => ({
        ...team,
        roundPoints: 0,
      }))
    );

    setReveal(DEFAULT_REVEAL);

    setMessage(
      `${reason} — ALL ROUND POINTS LOST`
    );

    addLog(
      `MISSION ${round} FAILED — ${reason}.`
    );

    triggerFlash(250);
    triggerShake(1000);
    playExplosion();
  }

  /* =========================================================
     BETWEEN MISSIONS
  ========================================================= */

  function openBetweenMission() {
    setNextMissionTime(startingTime);
    setStatus("between");
  }

  function launchNextMission() {
    const nextRound = round + 1;

    setRound(nextRound);
    setWires(createWires(nextRound));
    setTimeLeft(nextMissionTime);

    setActiveTeamId(null);
    setReveal(DEFAULT_REVEAL);
    setUndoSnapshot(null);

    setMessage(
      "New bomb armed. Start when ready."
    );

    setStatus("ready");
  }

  /* =========================================================
     END GAME
  ========================================================= */

  function endGame() {
    clearRevealTimers();

    setActiveTeamId(null);
    setReveal(DEFAULT_REVEAL);

    // Unbanked points do not count.
    setTeams((current) =>
      current.map((team) => ({
        ...team,
        roundPoints: 0,
      }))
    );

    setStatus("ended");
  }

  function resetGame() {
    clearRevealTimers();

    setTeams([]);
    setWires([]);

    setRound(1);
    setActiveTeamId(null);

    setReveal(DEFAULT_REVEAL);

    setMissionLog([]);
    setUndoSnapshot(null);

    setMessage(
      "Answer fast. Cut carefully. Save everybody."
    );

    setStatus("setup");
  }

  /* =========================================================
     STYLE HELPERS
  ========================================================= */

  const revealToneClasses = {
    neutral:
      "border-cyan-400/50 text-cyan-200",
    good:
      "border-emerald-400/60 text-emerald-300",
    bad:
      "border-orange-400/60 text-orange-300",
    danger:
      "border-red-500 text-red-400",
  };

  /* =========================================================
     SETUP SCREEN
  ========================================================= */

  if (status === "setup") {
    return (
      <main className="min-h-screen overflow-hidden bg-[#030508] text-white">
        <GlobalStyles />

        <GridBackground />

        <div className="relative min-h-screen flex items-center justify-center p-6">
          <div className="w-full max-w-4xl">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-3 border border-red-900/60 bg-red-950/30 px-5 py-2 rounded-full mb-6">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />

                <span className="text-xs tracking-[0.35em] font-black text-red-300">
                  MCGSN TACTICAL OPERATIONS
                </span>
              </div>

              <p className="text-xs tracking-[0.45em] text-slate-600 mb-3">
                MR. CEPHAS&apos; GAME SHOW NETWORK
              </p>

              <h1 className="text-6xl md:text-8xl font-black tracking-[-0.05em]">
                BOMB
                <span className="text-red-500">
                  {" "}
                  SQUAD
                </span>
              </h1>

              <p className="text-lg md:text-xl text-slate-400 mt-4 tracking-wide">
                ANSWER FAST. CUT CAREFULLY. SAVE
                EVERYBODY.
              </p>
            </div>

            <div className="border border-slate-700 bg-[#080c12] rounded-3xl overflow-hidden">
              <HazardBar />

              <div className="p-7 md:p-9">
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <p className="text-xs font-black tracking-[0.3em] text-slate-500 mb-3">
                      SQUAD COUNT
                    </p>

                    <div className="grid grid-cols-3 gap-3">
                      {[2, 3, 4].map((count) => (
                        <button
                          key={count}
                          onClick={() =>
                            setTeamCount(count)
                          }
                          className={`py-5 rounded-xl border font-black text-2xl transition ${
                            teamCount === count
                              ? "border-yellow-400 bg-yellow-400 text-black"
                              : "border-slate-700 bg-slate-950 hover:border-slate-500"
                          }`}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-black tracking-[0.3em] text-slate-500 mb-3">
                      MISSION CLOCK
                    </p>

                    <div className="grid grid-cols-3 gap-3">
                      {[
                        {
                          label: "2:00",
                          value: 120,
                        },
                        {
                          label: "3:00",
                          value: 180,
                        },
                        {
                          label: "5:00",
                          value: 300,
                        },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setStartingTime(
                              option.value
                            );

                            setNextMissionTime(
                              option.value
                            );
                          }}
                          className={`py-5 rounded-xl border font-mono font-black text-xl transition ${
                            startingTime ===
                            option.value
                              ? "border-red-500 bg-red-600 text-white"
                              : "border-slate-700 bg-slate-950 hover:border-slate-500"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-7 flex flex-col md:flex-row gap-3">
                  <button
                    onClick={setupGame}
                    className="flex-1 rounded-xl border border-red-400 bg-red-600 hover:bg-red-500 py-5 text-2xl font-black tracking-[0.12em]"
                  >
                    ARM THE BOMB
                  </button>

                  <button
                    onClick={() => {
                      getAudioContext();

                      setSoundOn(
                        (current) => !current
                      );
                    }}
                    className="md:w-48 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-900 py-4 font-black tracking-wider"
                  >
                    SOUND{" "}
                    {soundOn ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* =========================================================
     WINNER SCREEN
  ========================================================= */

  if (status === "ended") {
    return (
      <main className="min-h-screen bg-[#030508] text-white flex items-center justify-center p-6">
        <GlobalStyles />
        <GridBackground />

        <div className="relative w-full max-w-5xl text-center">
          <p className="text-xs tracking-[0.45em] text-yellow-500 mb-3 font-black">
            MCGSN FINAL RESULTS
          </p>

          <h1 className="text-5xl md:text-8xl font-black mb-3">
            MISSION COMPLETE
          </h1>

          <p className="text-slate-400 mb-8">
            {winners.length === 1
              ? `${winners[0].name} IS THE TOP BOMB SQUAD`
              : "WE HAVE A TIE"}
          </p>

          <div className="grid md:grid-cols-2 gap-4 max-w-3xl mx-auto mb-8">
            {sortedTeams.map(
              (team, index) => (
                <div
                  key={team.id}
                  className={`rounded-2xl border p-5 flex items-center justify-between ${
                    index === 0
                      ? "border-yellow-400 bg-yellow-400/10"
                      : "border-slate-800 bg-slate-950"
                  }`}
                >
                  <div className="text-left">
                    <p className="text-xs tracking-[0.2em] text-slate-500">
                      #{index + 1}
                    </p>

                    <p className="text-xl font-black">
                      {team.name}
                    </p>
                  </div>

                  <p className="text-4xl font-black font-mono">
                    {team.score.toLocaleString()}
                  </p>
                </div>
              )
            )}
          </div>

          <div className="flex justify-center gap-3">
            <button
              onClick={resetGame}
              className="bg-yellow-400 hover:bg-yellow-300 text-black px-8 py-4 rounded-xl font-black text-xl"
            >
              NEW GAME
            </button>

            <button
              onClick={() =>
                setShowLog(true)
              }
              className="border border-slate-700 bg-slate-950 hover:bg-slate-900 px-6 py-4 rounded-xl font-black"
            >
              MISSION LOG
            </button>
          </div>
        </div>

        <MissionLogPanel
          show={showLog}
          onClose={() => setShowLog(false)}
          missionLog={missionLog}
        />
      </main>
    );
  }

  /* =========================================================
     BETWEEN MISSION SCREEN
  ========================================================= */

  if (status === "between") {
    return (
      <main className="min-h-screen bg-[#030508] text-white flex items-center justify-center p-6">
        <GlobalStyles />
        <GridBackground />

        <div className="relative w-full max-w-5xl">
          <div className="text-center mb-8">
            <p className="text-xs tracking-[0.4em] text-slate-500 mb-2">
              MISSION {round} COMPLETE
            </p>

            <h1 className="text-5xl md:text-7xl font-black">
              PREPARE NEXT DEVICE
            </h1>

            <p className="text-slate-400 mt-3">
              Round {round + 1} will contain a
              newly randomized bomb.
            </p>
          </div>

          <div className="grid md:grid-cols-[1.3fr_.7fr] gap-5">
            <div className="border border-slate-800 bg-slate-950 rounded-2xl p-6">
              <p className="text-xs tracking-[0.25em] text-slate-500 mb-4 font-black">
                CURRENT STANDINGS
              </p>

              <div className="space-y-3">
                {sortedTeams.map(
                  (team, index) => (
                    <div
                      key={team.id}
                      className="flex items-center justify-between border-b border-slate-800 pb-3"
                    >
                      <div>
                        <span className="text-slate-600 mr-3">
                          #{index + 1}
                        </span>

                        <span className="font-black">
                          {team.name}
                        </span>
                      </div>

                      <span className="text-2xl font-black font-mono">
                        {team.score.toLocaleString()}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>

            <div className="border border-slate-800 bg-slate-950 rounded-2xl p-6">
              <p className="text-xs tracking-[0.25em] text-slate-500 mb-4 font-black">
                NEXT MISSION CLOCK
              </p>

              <div className="grid grid-cols-3 gap-2 mb-5">
                {[
                  {
                    label: "1:30",
                    value: 90,
                  },
                  {
                    label: "2:00",
                    value: 120,
                  },
                  {
                    label: "3:00",
                    value: 180,
                  },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() =>
                      setNextMissionTime(
                        option.value
                      )
                    }
                    className={`rounded-lg border py-3 font-black ${
                      nextMissionTime ===
                      option.value
                        ? "border-red-500 bg-red-600"
                        : "border-slate-700 bg-slate-900"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <button
                onClick={launchNextMission}
                className="w-full bg-red-600 hover:bg-red-500 rounded-xl py-4 font-black text-lg"
              >
                ARM MISSION {round + 1}
              </button>

              <button
                onClick={endGame}
                className="w-full mt-3 border border-slate-700 bg-slate-900 hover:bg-slate-800 rounded-xl py-3 font-black"
              >
                END GAME
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* =========================================================
     MAIN GAME SCREEN
  ========================================================= */

  return (
    <main
      className={`min-h-screen overflow-x-hidden text-white transition-colors duration-500 ${
        status === "exploded"
          ? "bg-[#260303]"
          : status === "defused"
          ? "bg-[#03160e]"
          : isCritical
          ? "bg-[#160305]"
          : "bg-[#030508]"
      } ${shake ? "bomb-shake" : ""}`}
    >
      <GlobalStyles />

      {flash && (
        <div className="fixed inset-0 z-[100] bg-white pointer-events-none opacity-80" />
      )}

      {(isWarning || isCritical) && (
        <div
          className={`fixed inset-0 pointer-events-none z-0 ${
            isCritical
              ? "border-[10px]"
              : "border-4"
          } border-red-600/50`}
          style={{
            animation: `warningPulse ${
              isCritical ? "0.5s" : "1.2s"
            } ease-in-out infinite`,
          }}
        />
      )}

      <GridBackground />

      <div className="relative z-10 max-w-[1600px] mx-auto p-3 md:p-5">
        {/* HEADER */}

        <header className="flex items-center justify-between gap-4 mb-3">
          <div>
            <p className="text-[10px] md:text-xs tracking-[0.32em] text-slate-600">
              MR. CEPHAS&apos; GAME SHOW NETWORK
            </p>

            <div className="flex items-center gap-3">
              <span
                className={`w-3 h-3 rounded-full ${
                  status === "defused"
                    ? "bg-emerald-400"
                    : status === "exploded"
                    ? "bg-red-500"
                    : "bg-red-500 animate-pulse"
                }`}
              />

              <h1 className="text-2xl md:text-3xl font-black">
                BOMB SQUAD
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setShowLog(true)
              }
              className="border border-slate-700 bg-slate-950 px-3 py-2 rounded-lg text-xs font-black"
            >
              LOG
            </button>

            <button
              onClick={() =>
                setShowTeacherTools(
                  (current) => !current
                )
              }
              className="border border-slate-700 bg-slate-950 px-3 py-2 rounded-lg text-xs font-black"
            >
              TOOLS
            </button>

            <button
              onClick={() => {
                getAudioContext();

                setSoundOn(
                  (current) => !current
                );
              }}
              className="border border-slate-700 bg-slate-950 px-3 py-2 rounded-lg text-xs font-black"
            >
              {soundOn
                ? "🔊 SOUND"
                : "🔇 MUTED"}
            </button>

            <div className="border border-slate-700 bg-slate-950 rounded-lg px-4 py-2 text-center">
              <p className="text-[9px] tracking-[0.25em] text-slate-500">
                ROUND
              </p>

              <p className="text-xl leading-none font-black">
                {round}
              </p>
            </div>
          </div>
        </header>

        {/* TEAM SCOREBOARDS */}

        <section
          className={`grid gap-2 mb-3 ${
            teams.length === 2
              ? "grid-cols-2"
              : teams.length === 3
              ? "grid-cols-3"
              : "grid-cols-2 md:grid-cols-4"
          }`}
        >
          {teams.map((team) => (
            <div
              key={team.id}
              className={`relative overflow-hidden rounded-xl border px-4 py-3 ${
                activeTeamId === team.id
                  ? "border-yellow-400 bg-yellow-400/10"
                  : "border-slate-800 bg-[#070b10]"
              }`}
            >
              {activeTeamId === team.id && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-yellow-400" />
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-black">
                    {team.name}
                  </p>

                  <p className="text-[9px] tracking-[0.2em] text-slate-600">
                    BANKED
                  </p>
                </div>

                <p className="text-2xl md:text-3xl font-black font-mono">
                  {team.score.toLocaleString()}
                </p>
              </div>

              <div className="mt-2 border-t border-slate-800 pt-2 flex justify-between">
                <span className="text-[10px] tracking-[0.18em] text-slate-600">
                  AT RISK
                </span>

                <span className="text-sm font-black text-yellow-400">
                  +
                  {team.roundPoints.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </section>

        {/* TEACHER TOOLS */}

        {showTeacherTools && (
          <section className="mb-3 border border-yellow-500/30 bg-yellow-950/10 rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs tracking-[0.25em] font-black text-yellow-400">
                TEACHER CONTROL PANEL
              </p>

              <button
                onClick={() =>
                  setShowTeacherTools(false)
                }
                className="text-slate-500"
              >
                ✕
              </button>
            </div>

            <div className="grid md:grid-cols-4 gap-2">
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="bg-black/30 border border-slate-800 rounded-lg p-2"
                >
                  <p className="text-xs font-black mb-2">
                    {team.name}
                  </p>

                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() =>
                        adjustScore(
                          team.id,
                          250
                        )
                      }
                      className="bg-emerald-900/50 rounded py-1 text-xs font-black"
                    >
                      +250
                    </button>

                    <button
                      onClick={() =>
                        adjustScore(
                          team.id,
                          -250
                        )
                      }
                      className="bg-red-950/60 rounded py-1 text-xs font-black"
                    >
                      −250
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                disabled={!undoSnapshot}
                onClick={undoLastAction}
                className="flex-1 bg-slate-800 disabled:opacity-30 rounded-lg py-2 text-xs font-black"
              >
                ↶ UNDO LAST ACTION
              </button>

              <button
                onClick={endGame}
                className="bg-red-950/60 border border-red-900 rounded-lg px-5 text-xs font-black"
              >
                END GAME
              </button>
            </div>
          </section>
        )}

        {/* BOMB */}

        <section
          className={`relative rounded-[28px] border overflow-hidden ${
            status === "defused"
              ? "border-emerald-600/60 victory-panel"
              : status === "exploded"
              ? "border-red-600 explosion-panel"
              : isCritical
              ? "border-red-600"
              : "border-slate-700"
          } bg-[#080b0e]`}
        >
          <HazardBar />

          <div className="relative px-4 md:px-7 pt-4 md:pt-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    status === "defused"
                      ? "bg-emerald-400"
                      : "bg-red-500 animate-pulse"
                  }`}
                />

                <span className="text-[10px] md:text-xs tracking-[0.28em] font-black text-slate-500">
                  DEVICE STATUS
                </span>
              </div>

              <div className="text-[10px] md:text-xs tracking-[0.22em] text-slate-600">
                {remainingWires.length} CIRCUITS
                ACTIVE
              </div>
            </div>

            {/* TIMER */}

            <div className="relative max-w-4xl mx-auto">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-b from-slate-600/30 to-black" />

              <div className="relative rounded-2xl border border-slate-600 bg-[#020303] px-4 py-3 md:py-4 text-center overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-2 bg-red-600" />
                <div className="absolute right-0 top-0 bottom-0 w-2 bg-red-600" />

                <p className="text-[10px] md:text-xs tracking-[0.4em] font-black mb-1 text-red-500">
                  {status === "paused"
                    ? "CLOCK SUSPENDED"
                    : "SHARED MISSION CLOCK"}
                </p>

                <div
                  className={`font-mono font-black tracking-[-0.07em] leading-[0.9] text-7xl md:text-[7.5rem] ${
                    isCritical
                      ? "text-red-500"
                      : isWarning
                      ? "text-orange-400"
                      : "text-red-400"
                  }`}
                  style={{
                    textShadow:
                      "0 0 25px rgba(239,68,68,.35)",
                  }}
                >
                  {formatTime(timeLeft)}
                </div>

                <div className="mt-2 min-h-[28px]">
                  <p
                    className={`font-black tracking-[0.12em] text-sm md:text-base ${
                      activeTeamId !== null
                        ? "text-yellow-300"
                        : "text-slate-500"
                    }`}
                  >
                    {message}
                  </p>
                </div>
              </div>
            </div>

            {/* REVEAL */}

            {reveal.phase !== "idle" && (
              <div className="absolute inset-x-4 md:inset-x-7 top-[55px] md:top-[65px] z-40 flex justify-center pointer-events-none">
                <div
                  className={`w-full max-w-3xl border-2 rounded-2xl bg-[#030609]/95 px-5 py-7 md:py-9 text-center backdrop-blur-sm ${
                    revealToneClasses[
                      reveal.tone
                    ]
                  } ${
                    reveal.phase ===
                    "analyzing"
                      ? "analysis-pulse"
                      : ""
                  }`}
                >
                  {reveal.phase ===
                    "analyzing" && (
                    <div className="flex justify-center gap-2 mb-4">
                      {[0, 1, 2].map(
                        (dot) => (
                          <span
                            key={dot}
                            className="w-3 h-3 rounded-full bg-current"
                          />
                        )
                      )}
                    </div>
                  )}

                  <p className="text-3xl md:text-5xl font-black">
                    {reveal.title}
                  </p>

                  <p className="mt-3 text-sm md:text-lg tracking-[0.22em] font-bold opacity-80">
                    {reveal.subtitle}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* WIRES */}

          <div className="px-4 md:px-7 pb-4 md:pb-5 mt-4">
            <div className="rounded-2xl border border-slate-700 bg-[#050709] p-4 md:p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] tracking-[0.3em] font-black text-slate-600">
                  CIRCUIT ACCESS PANEL
                </p>

                <p className="text-[10px] tracking-[0.25em] font-black text-red-500">
                  ⚠ CUT ONLY WHEN AUTHORIZED
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {wires.map((wire) => {
                  const canCut =
                    status === "running" &&
                    activeTeamId !== null &&
                    reveal.phase ===
                      "idle" &&
                    !wire.cut;

                  return (
                    <button
                      key={wire.id}
                      disabled={!canCut}
                      onClick={() =>
                        cutWire(wire.id)
                      }
                      className={`relative h-32 md:h-36 rounded-xl border overflow-hidden transition-all ${
                        wire.cut
                          ? "border-slate-800 bg-black/60"
                          : canCut
                          ? "border-yellow-400/60 bg-slate-950 hover:border-yellow-300 hover:-translate-y-1 cursor-pointer"
                          : "border-slate-800 bg-slate-950"
                      }`}
                    >
                      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-5 rounded-md border border-slate-500 bg-gradient-to-b from-slate-500 to-slate-800">
                        <div className="absolute inset-1 rounded-sm bg-black" />
                      </div>

                      {!wire.cut ? (
                        <>
                          <div
                            className="absolute top-7 bottom-7 left-1/2 -translate-x-1/2 w-5 rounded-full"
                            style={{
                              background: `linear-gradient(90deg, ${wire.darkColor}, ${wire.color}, ${wire.darkColor})`,
                              boxShadow:
                                canCut
                                  ? `0 0 18px ${wire.color}55`
                                  : "none",
                              animation:
                                canCut
                                  ? "cablePulse 1.2s ease-in-out infinite"
                                  : "none",
                            }}
                          />

                          <div className="absolute bottom-2 left-0 right-0 text-center">
                            <span
                              className="text-[10px] md:text-xs font-black tracking-[0.16em]"
                              style={{
                                color:
                                  wire.colorName ===
                                  "WHITE"
                                    ? "#f8fafc"
                                    : wire.color,
                              }}
                            >
                              {
                                wire.colorName
                              }
                            </span>

                            {canCut && (
                              <div className="text-[9px] text-yellow-300 mt-1 font-black tracking-widest">
                                CUT CIRCUIT
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            className="absolute top-7 h-8 left-1/2 -translate-x-1/2 w-5 rounded-full"
                            style={{
                              background: `linear-gradient(90deg, ${wire.darkColor}, ${wire.color}, ${wire.darkColor})`,
                            }}
                          />

                          <div
                            className="absolute bottom-7 h-8 left-1/2 -translate-x-1/2 w-5 rounded-full"
                            style={{
                              background: `linear-gradient(90deg, ${wire.darkColor}, ${wire.color}, ${wire.darkColor})`,
                            }}
                          />

                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-10 h-[2px] bg-orange-300 rotate-[-15deg] shadow-[0_0_10px_rgba(251,146,60,.8)]" />
                          </div>

                          <div className="absolute bottom-2 left-0 right-0 text-center text-[10px] tracking-[0.2em] font-black text-slate-600">
                            SEVERED
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* DEFUSED OVERLAY */}

          {status === "defused" && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#020b07]/94 backdrop-blur-sm">
              <div className="text-center px-6">
                <p className="text-emerald-500 text-sm tracking-[0.5em] font-black mb-4">
                  MISSION COMPLETE
                </p>

                <h2 className="text-5xl md:text-8xl font-black text-emerald-300">
                  BOMB DEFUSED
                </h2>

                <p className="text-slate-300 mt-5 text-lg font-bold">
                  {message}
                </p>

                <RoundEndButtons
                  onNext={
                    openBetweenMission
                  }
                  onEnd={endGame}
                />
              </div>
            </div>
          )}

          {/* EXPLOSION OVERLAY */}

          {status === "exploded" && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#170202]/94 backdrop-blur-sm">
              <div className="text-center px-6">
                <div className="text-7xl mb-2">
                  💥
                </div>

                <p className="text-red-500 text-sm tracking-[0.5em] font-black mb-3">
                  MISSION FAILED
                </p>

                <h2 className="text-5xl md:text-8xl font-black text-red-400">
                  BOMB DETONATED
                </h2>

                <p className="text-slate-300 mt-5 text-lg font-bold">
                  {message}
                </p>

                <RoundEndButtons
                  onNext={
                    openBetweenMission
                  }
                  onEnd={endGame}
                />
              </div>
            </div>
          )}
        </section>

        {/* HOST CONTROLS */}

        <section className="mt-3 rounded-xl border border-slate-800 bg-[#070a0e] p-3">
          {status === "ready" && (
            <div className="flex gap-3">
              <button
                onClick={startBomb}
                className="flex-1 bg-red-600 hover:bg-red-500 rounded-lg py-3 font-black tracking-[0.15em]"
              >
                ▶ START MISSION CLOCK
              </button>

              <button
                onClick={endGame}
                className="border border-slate-700 bg-slate-950 rounded-lg px-5 font-black text-sm"
              >
                END GAME
              </button>
            </div>
          )}

          {(status === "running" ||
            status === "paused") && (
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="flex-1">
                <p className="text-[9px] tracking-[0.28em] text-slate-600 font-black mb-2">
                  CORRECT ANSWER — AUTHORIZE WIRE
                  CUT
                </p>

                <div
                  className={`grid gap-2 ${
                    teams.length === 2
                      ? "grid-cols-2"
                      : teams.length === 3
                      ? "grid-cols-3"
                      : "grid-cols-2 md:grid-cols-4"
                  }`}
                >
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      disabled={
                        status !==
                          "running" ||
                        activeTeamId !==
                          null ||
                        reveal.phase !==
                          "idle"
                      }
                      onClick={() =>
                        markTeamCorrect(
                          team.id
                        )
                      }
                      className="bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-900 disabled:text-slate-700 border border-cyan-500/30 disabled:border-slate-800 rounded-lg py-2.5 font-black text-sm"
                    >
                      {team.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="lg:w-44 flex">
                <button
                  onClick={pauseBomb}
                  className="w-full border border-slate-700 bg-slate-900 hover:bg-slate-800 rounded-lg py-3 px-4 font-black text-xs tracking-wider"
                >
                  {status === "paused"
                    ? "▶ RESUME"
                    : "Ⅱ CLASS HOLD"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <MissionLogPanel
        show={showLog}
        onClose={() => setShowLog(false)}
        missionLog={missionLog}
      />
    </main>
  );
}

/* =========================================================
   SMALL COMPONENTS
========================================================= */

function HazardBar() {
  return (
    <div className="h-2 bg-[repeating-linear-gradient(135deg,#d4a90b_0px,#d4a90b_16px,#15191f_16px,#15191f_32px)]" />
  );
}

function GridBackground() {
  return (
    <div
      className="fixed inset-0 pointer-events-none opacity-[0.025]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)",
        backgroundSize: "38px 38px",
      }}
    />
  );
}

function RoundEndButtons({
  onNext,
  onEnd,
}: {
  onNext: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="flex justify-center gap-3 mt-8">
      <button
        onClick={onNext}
        className="bg-yellow-400 hover:bg-yellow-300 text-black px-8 py-4 rounded-xl font-black text-xl"
      >
        CONTINUE
      </button>

      <button
        onClick={onEnd}
        className="bg-slate-900 hover:bg-slate-800 border border-slate-700 px-6 py-4 rounded-xl font-black"
      >
        END GAME
      </button>
    </div>
  );
}

function MissionLogPanel({
  show,
  onClose,
  missionLog,
}: {
  show: boolean;
  onClose: () => void;
  missionLog: MissionLogEntry[];
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/75 flex justify-end">
      <div className="w-full max-w-md h-full bg-[#080b0f] border-l border-slate-700 p-5 overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[10px] tracking-[0.3em] text-slate-500">
              BOMB SQUAD
            </p>

            <h2 className="text-2xl font-black">
              MISSION LOG
            </h2>
          </div>

          <button
            onClick={onClose}
            className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-700"
          >
            ✕
          </button>
        </div>

        {missionLog.length === 0 ? (
          <p className="text-slate-600">
            No mission activity yet.
          </p>
        ) : (
          <div className="space-y-3">
            {missionLog.map((entry) => (
              <div
                key={entry.id}
                className="border border-slate-800 bg-slate-950 rounded-xl p-3"
              >
                <p className="text-[9px] tracking-[0.2em] text-red-500 font-black mb-1">
                  MISSION {entry.round}
                </p>

                <p className="text-sm text-slate-300">
                  {entry.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GlobalStyles() {
  return (
    <style jsx global>{`
      @keyframes bombShake {
        0%,
        100% {
          transform: translate(0, 0);
        }
        20% {
          transform: translate(-5px, 2px);
        }
        40% {
          transform: translate(5px, -2px);
        }
        60% {
          transform: translate(-3px, -1px);
        }
        80% {
          transform: translate(3px, 2px);
        }
      }

      .bomb-shake {
        animation: bombShake 0.13s linear infinite;
      }

      @keyframes warningPulse {
        0%,
        100% {
          opacity: 0.2;
        }
        50% {
          opacity: 0.8;
        }
      }

      @keyframes cablePulse {
        0%,
        100% {
          filter: brightness(0.85);
        }
        50% {
          filter: brightness(1.3);
        }
      }

      @keyframes analysisPulse {
        0%,
        100% {
          opacity: 0.55;
        }
        50% {
          opacity: 1;
        }
      }

      @keyframes victoryPulse {
        0%,
        100% {
          box-shadow: 0 0 25px
            rgba(16, 185, 129, 0.12);
        }
        50% {
          box-shadow: 0 0 75px
            rgba(16, 185, 129, 0.4);
        }
      }

      @keyframes explosionPulse {
        0%,
        100% {
          box-shadow: 0 0 30px
            rgba(239, 68, 68, 0.2);
        }
        50% {
          box-shadow: 0 0 90px
            rgba(239, 68, 68, 0.55);
        }
      }

      .analysis-pulse {
        animation: analysisPulse 0.7s
          ease-in-out infinite;
      }

      .victory-panel {
        animation: victoryPulse 1.4s
          ease-in-out infinite;
      }

      .explosion-panel {
        animation: explosionPulse 0.6s
          ease-in-out infinite;
      }
    `}</style>
  );
}