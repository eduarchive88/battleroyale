
import React, { useState, useEffect, useRef } from 'react';

interface JoystickProps {
  onMove: (dir: { x: number; y: number }) => void;
}

export const Joystick: React.FC<JoystickProps> = ({ onMove }) => {
  const [isMoving, setIsMoving] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    setIsMoving(true);
  };

  const handleEnd = () => {
    setIsMoving(false);
    setPos({ x: 0, y: 0 });
    onMove({ x: 0, y: 0 });
  };

  const handleMove = (e: any) => {
    if (!isMoving || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    let clientX, clientY;
    if (e.touches) {
      clientX = e.touches[0].clientX - rect.left;
      clientY = e.touches[0].clientY - rect.top;
    } else {
      clientX = e.clientX - rect.left;
      clientY = e.clientY - rect.top;
    }

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = rect.width / 2;
    
    const limitedX = dx / maxDist;
    const limitedY = dy / maxDist;
    
    setPos({ x: Math.min(Math.max(dx, -maxDist), maxDist), y: Math.min(Math.max(dy, -maxDist), maxDist) });
    onMove({ x: limitedX, y: limitedY });
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-32 h-32 bg-white/10 rounded-full border-2 border-white/20 touch-none select-none"
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onMouseDown={handleStart}
      onMouseMove={handleMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
    >
      <div 
        className="absolute w-12 h-12 bg-white/40 rounded-full shadow-lg pointer-events-none"
        style={{
          left: `calc(50% + ${pos.x}px - 24px)`,
          top: `calc(50% + ${pos.y}px - 24px)`
        }}
      />
    </div>
  );
};
