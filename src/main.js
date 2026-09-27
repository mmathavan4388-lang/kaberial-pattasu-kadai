import './ui/ui.css';
import { Game } from './game/Game.js';

const game = new Game(document.getElementById('game'), document.getElementById('ui'));
game.boot();
window.__game = game; // handy for debugging in the console
