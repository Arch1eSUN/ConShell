import { useEffect, useRef } from 'react';

/**
 * Conway's Game of Life — runs as a background canvas layer.
 * Muted green cells on paper, slow evolution (500ms ticks).
 */

const CELL_SIZE = 8;
const TICK_MS = 500;
const ALIVE_COLOR = 'rgba(34, 197, 94, 0.12)'; // --green at 12%

function createGrid(cols: number, rows: number): boolean[][] {
    return Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => Math.random() < 0.15),
    );
}

function countNeighbors(grid: boolean[][], r: number, c: number): number {
    const rows = grid.length;
    const cols = grid[0].length;
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = (r + dr + rows) % rows;
            const nc = (c + dc + cols) % cols;
            if (grid[nr][nc]) count++;
        }
    }
    return count;
}

function nextGeneration(grid: boolean[][]): boolean[][] {
    return grid.map((row, r) =>
        row.map((alive, c) => {
            const n = countNeighbors(grid, r, c);
            return alive ? n === 2 || n === 3 : n === 3;
        }),
    );
}

export function ConwayBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gridRef = useRef<boolean[][] | null>(null);
    const animRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Check reduced motion
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const cols = Math.floor(canvas.width / CELL_SIZE);
            const rows = Math.floor(canvas.height / CELL_SIZE);
            gridRef.current = createGrid(cols, rows);
        };

        resize();
        window.addEventListener('resize', resize);

        const draw = () => {
            const grid = gridRef.current;
            if (!grid || !ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = ALIVE_COLOR;

            for (let r = 0; r < grid.length; r++) {
                for (let c = 0; c < grid[r].length; c++) {
                    if (grid[r][c]) {
                        ctx.fillRect(
                            c * CELL_SIZE,
                            r * CELL_SIZE,
                            CELL_SIZE - 1,
                            CELL_SIZE - 1,
                        );
                    }
                }
            }
        };

        draw(); // initial render

        if (!prefersReduced) {
            let lastTick = 0;
            const loop = (time: number) => {
                if (time - lastTick >= TICK_MS) {
                    lastTick = time;
                    if (gridRef.current) {
                        gridRef.current = nextGeneration(gridRef.current);
                        draw();
                    }
                }
                animRef.current = requestAnimationFrame(loop);
            };
            animRef.current = requestAnimationFrame(loop);
        }

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animRef.current);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 0,
                pointerEvents: 'none',
            }}
        />
    );
}
