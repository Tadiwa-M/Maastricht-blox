// The contextual prompt pill ("Sit down (G)", "Ride bike (G)", ...): centred just above the walk
// bar, a button you can tap or click; hidden on the title screen, while riding a bus or train
// and in screenshots.
const CSS = `
#ac-prompt { position: fixed; left: 50%; bottom: calc(70px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  z-index: 5; background: rgba(18,22,30,.78); backdrop-filter: blur(8px); color: #f3f1ea; border: 1px solid rgba(255,207,90,.6);
  border-radius: 999px; padding: 7px 16px; font: 600 14px system-ui, sans-serif; cursor: pointer; white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0,0,0,.25); touch-action: manipulation; max-width: calc(100vw - 32px); }
#ac-prompt[hidden] { display: none; }
#ac-prompt:active { transform: translateX(-50%) translateY(1px); }
@media (pointer: coarse) { #ac-prompt { padding: 11px 20px; font-size: 15px; } }
body.title #ac-prompt, body.riding #ac-prompt, body.shot #ac-prompt { display: none !important; }
`;

export class Prompt {
  constructor(onPress) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.el = document.createElement('button');
    this.el.id = 'ac-prompt';
    this.el.type = 'button';
    this.el.hidden = true;
    this.el.addEventListener('click', (e) => { e.stopPropagation(); onPress(); });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation()); // not a look drag / joystick touch
    document.body.append(this.el);
    this.text = '';
  }

  show(text) {
    if (text === this.text) return;
    this.text = text;
    this.el.hidden = !text;
    if (text) this.el.textContent = text;
  }
}
