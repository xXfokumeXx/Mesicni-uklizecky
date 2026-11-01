// Chat v multiplayeru: Enter = psát, Enter = odeslat, Esc = zavřít.
// Panel vlevo dole: po každé nové zprávě se na PEEK_MS ukáže poslední historie (kolik se vejde do okna)
// a pak plynule zmizí; při psaní je vidět celá historie a dá se v ní posouvat.
import { SUIT_COLORS } from './catalog.js';

const $ = id => document.getElementById(id);
const MAX = 60, PEEK_MS = 5000;
let hooks = null;
let peekTimer = 0;
const hhmm = t => new Date(t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

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
}

// Na chvíli ukázat poslední zprávy (po nové zprávě).
function peek() {
  const chat = $('chat');
  chat.classList.add('chat--peek');
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => chat.classList.remove('chat--peek'), PEEK_MS);
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

export function addMessage({ name, color, text, system, me }) {
  const log = $('chat-log');
  const li = document.createElement('li');
  li.className = 'chat__msg' + (system ? ' chat__msg--system' : '') + (me ? ' chat__msg--me' : '');
  if (system) {
    li.textContent = text;
  } else {
    li.style.setProperty('--who', '#' + (SUIT_COLORS[color]?.hex ?? 0xeceae3).toString(16).padStart(6, '0'));
    const head = document.createElement('span');
    head.className = 'chat__head';
    const who = document.createElement('span');
    who.className = 'chat__name';
    who.textContent = me ? `${name} (ty)` : name;
    const time = document.createElement('time');
    time.className = 'chat__time';
    time.textContent = hhmm(Date.now());
    head.append(who, time);
    const body = document.createElement('span');
    body.className = 'chat__text';
    body.textContent = text;
    li.append(head, body);
  }
  log.append(li);
  while (log.children.length > MAX) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  peek();
}
