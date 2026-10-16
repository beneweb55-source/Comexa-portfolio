"use client";

/*
 * Cadran du minuteur : un anneau qui se remplit, le décompte au centre.
 *
 * L'anneau raconte quelque chose de vrai : avec une estimation, la part du
 * temps estimé déjà consommée (saisies précédentes + session en cours), rose
 * au-delà ; sans estimation, un tour par heure, pour que le temps se voie
 * passer. Vert quand il tourne, jaune en pause, gris à l'arrêt.
 */

import { splitElapsed } from "@/lib/timer-format.mjs";

export default function TimerDial({ elapsedSeconds = 0, status = null, progress = null, size = 184, caption = null }) {
  const stroke = Math.max(8, Math.round(size / 18));
  const radius = (size - stroke) / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(1, Math.max(0, progress?.ratio ?? 0));
  const offset = circumference * (1 - ratio);
  const angle = ratio * 2 * Math.PI - Math.PI / 2;
  const knobX = size / 2 + radius * Math.cos(angle);
  const knobY = size / 2 + radius * Math.sin(angle);
  const { hours, minutes, seconds } = splitElapsed(elapsedSeconds);
  const state = status === "RUNNING" ? "running" : status === "PAUSED" ? "paused" : "idle";

  return (
    <div
      className={`sui-timer-dial is-${state}${progress?.over ? " is-over" : ""}`}
      style={{ "--dial-size": `${size}px` }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
        <circle className="sui-timer-dial__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="sui-timer-dial__arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {state !== "idle" && ratio > 0 ? (
          <circle className="sui-timer-dial__knob" cx={knobX} cy={knobY} r={stroke / 2 + 2} />
        ) : null}
      </svg>
      <div className="sui-timer-dial__face">
        <span className="sui-timer-dial__digits" role="timer" aria-label={`${Number(hours)} h ${Number(minutes)} min ${Number(seconds)} s`}>
          {hours}:{minutes}
          <span className="sui-timer-dial__seconds">:{seconds}</span>
        </span>
        {caption ? <span className="sui-timer-dial__caption">{caption}</span> : null}
      </div>
    </div>
  );
}
