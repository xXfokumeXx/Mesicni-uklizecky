// Chat v multiplayeru: Enter = psát, Enter = odeslat, Esc = zavřít.
// Zprávy se ukazují vlevo dole a po chvíli vyblednou; při psaní je vidět celá historie.
import { SUIT_COLORS } from './catalog.js';

const $ = id => document.getElementById(id);
const MAX = 50, FADE_MS = 14000;
let hooks = null;

export function initChat(h) {
  hooks = h;                                   // { send(text) → bool, onOpen, onClose }
  const form = $('chat-form'), input = $('chat-input');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    if (text.trim()) hooks.send(text);
    closeChat();
  });
  input.addEventListener('keydown', e => {
    e.stopPropagation();                       // klávesy při psaní nehýbou astronautem
    if (e.key === 'Escape') { input.value = ''; closeChat(); }
  });
  input.addEventListener('keyup', e => e.stopPropagation());
  setInterval(fade, 1000);
}

export function showChat(on) {
  $('chat').hidden = !on;
}

export const chatOpen = () => !$('chat-form').hidden;

export function openChat() {
  if ($('chat').hidden || chatOpen()) return;
  $('chat-form').hidden = false;
  $('chat').classList.add('chat--open');
  hooks.onOpen?.();
  $('chat-input').focus();
}

export function closeChat() {
  if (!chatOpen()) return;
  $('chat-form').hidden = true;
  $('chat').classList.remove('chat--open');
  $('chat-input').blur();
  hooks.onClose?.();
}

export function addMessage({ name, color, text, system }) {
  const log = $('chat-log');
  const li = document.createElement('li');
  li.className = 'chat__msg' + (system ? ' chat__msg--system' : '');
  li.dataset.t = String(Date.now());
  if (system) {
    li.textContent = text;
  } else {
    const who = document.createElement('span');
    who.className = 'chat__name';
    who.textContent = name;
    who.style.setProperty('--who', '#' + (SUIT_COLORS[color]?.hex ?? 0xeceae3).toString(16).padStart(6, '0'));
    const body = document.createElement('span');
    body.className = 'chat__text';
    body.textContent = text;
    li.append(who, body);
  }
  log.append(li);
  while (log.children.length > MAX) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

function fade() {
  const now = Date.now();
  for (const li of $('chat-log').children) {
    li.classList.toggle('chat__msg--old', now - Number(li.dataset.t) > FADE_MS);
  }
}
