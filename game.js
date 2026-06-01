// Uboost Runner Game Logic

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const uiLayer = document.getElementById('ui-layer');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const hud = document.getElementById('hud');
const scoreDisplay = document.getElementById('score-display');
const statsList = document.getElementById('stats-list');
const boostIndicator = document.getElementById('boost-indicator');

const btnStart = document.getElementById('btn-start');
const btnRestart = document.getElementById('btn-restart');
const btnShare = document.getElementById('btn-share');
const btnUboost = document.getElementById('btn-uboost');

// Telegram WebApp Init
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
}

// Setup Canvas Size
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Game State
let isPlaying = false;
let animationId;
let score = 0;
let frames = 0;
let gameSpeed = 5;

// Stats for Share Card
let stats = {
    captchas: 0,
    ads: 0,
    geoblocks: 0,
    lags: 0
};

// Player (Mascot)
const player = {
    x: 50,
    y: canvas.height / 2,
    width: 40,
    height: 40,
    velocity: 0,
    gravity: 0.6,
    jumpStrength: -10,
    isBoosting: false,
    boostTimer: 0,

    draw() {
        ctx.fillStyle = this.isBoosting ? '#00f2fe' : '#fff';
        // Placeholder for Mascot
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Draw face (simple)
        ctx.fillStyle = '#000';
        ctx.fillRect(this.x + 25, this.y + 10, 5, 5); // eye
        ctx.fillRect(this.x + 25, this.y + 25, 10, 5); // mouth
    },

    update() {
        this.velocity += this.gravity;
        this.y += this.velocity;

        // Ground/Ceiling collision
        if (this.y + this.height >= canvas.height) {
            this.y = canvas.height - this.height;
            this.velocity = 0;
        }
        if (this.y <= 0) {
            this.y = 0;
            this.velocity = 0;
        }

        // Boost logic
        if (this.isBoosting) {
            this.boostTimer--;
            if (this.boostTimer <= 0) {
                this.isBoosting = false;
                boostIndicator.classList.add('hidden');
                gameSpeed = 5 + Math.floor(score / 500); // Reset speed but keep some progression
            }
        }
    },

    jump() {
        this.velocity = this.jumpStrength;
    },

    activateBoost() {
        this.isBoosting = true;
        this.boostTimer = 300; // ~5 seconds at 60fps
        boostIndicator.classList.remove('hidden');
        gameSpeed = 12; // Hyper speed!
    }
};

// Obstacles
const obstacles = [];
const obstacleTypes = [
    { type: 'captcha', color: '#ff4d4d', label: 'КАПЧА', stat: 'captchas' },
    { type: 'ad', color: '#ffcc00', label: 'РЕКЛАМА', stat: 'ads' },
    { type: 'geoblock', color: '#666', label: 'ГЕОБЛОК', stat: 'geoblocks' },
    { type: 'lag', color: '#9933ff', label: 'ЛАГ', stat: 'lags' }
];

class Obstacle {
    constructor() {
        this.x = canvas.width;
        this.width = 40 + Math.random() * 40;
        this.height = 40 + Math.random() * 80;
        this.y = Math.random() * (canvas.height - this.height);
        
        const typeInfo = obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
        this.type = typeInfo.type;
        this.color = typeInfo.color;
        this.label = typeInfo.label;
        this.stat = typeInfo.stat;
        this.passed = false;
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.fillText(this.label, this.x + 2, this.y + 20);
    }

    update() {
        this.x -= gameSpeed;
        if (!this.passed && this.x + this.width < player.x) {
            this.passed = true;
            stats[this.stat]++;
            score += 10;
        }
    }
}

// Boost Pickups
const boosts = [];
class Boost {
    constructor() {
        this.x = canvas.width;
        this.y = Math.random() * (canvas.height - 30);
        this.width = 30;
        this.height = 30;
    }
    
    draw() {
        ctx.fillStyle = '#00f2fe';
        ctx.beginPath();
        ctx.arc(this.x + 15, this.y + 15, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = '10px Arial';
        ctx.fillText('VPN', this.x + 4, this.y + 19);
    }

    update() {
        this.x -= gameSpeed;
    }
}

// Game Loop
function initGame() {
    player.y = canvas.height / 2;
    player.velocity = 0;
    player.isBoosting = false;
    obstacles.length = 0;
    boosts.length = 0;
    score = 0;
    frames = 0;
    gameSpeed = 5;
    
    stats = { captchas: 0, ads: 0, geoblocks: 0, lags: 0 };
    
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    boostIndicator.classList.add('hidden');
    
    isPlaying = true;
    animate();
}

function gameOver() {
    isPlaying = false;
    cancelAnimationFrame(animationId);
    
    // Populate stats
    statsList.innerHTML = `
        <li>${stats.captchas} капч</li>
        <li>${stats.ads} поп-апов казино</li>
        <li>${stats.geoblocks} геоблоков</li>
        <li>${stats.lags} лагов</li>
    `;
    
    hud.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
}

function handleCollisions() {
    // Obstacles
    for (let i = 0; i < obstacles.length; i++) {
        const obs = obstacles[i];
        
        // AABB Collision
        if (player.x < obs.x + obs.width &&
            player.x + player.width > obs.x &&
            player.y < obs.y + obs.height &&
            player.y + player.height > obs.y) {
            
            if (player.isBoosting) {
                // Destroy obstacle, give bonus score
                obstacles.splice(i, 1);
                score += 50;
                i--;
            } else {
                gameOver();
                return;
            }
        }
    }

    // Boosts
    for (let i = 0; i < boosts.length; i++) {
        const b = boosts[i];
        if (player.x < b.x + b.width &&
            player.x + player.width > b.x &&
            player.y < b.y + b.height &&
            player.y + player.height > b.y) {
            
            player.activateBoost();
            boosts.splice(i, 1);
            i--;
        }
    }
}

function animate() {
    if (!isPlaying) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Difficulty progression (if not boosting)
    if (!player.isBoosting && frames % 600 === 0) {
        gameSpeed += 0.5;
    }

    // Spawning logic
    // Spawn Obstacle
    if (frames % Math.max(60, Math.floor(120 - gameSpeed * 5)) === 0) {
        obstacles.push(new Obstacle());
    }
    
    // Spawn Boost (Rare)
    if (frames % 400 === 0 && Math.random() > 0.5) {
        boosts.push(new Boost());
    }

    // Update & Draw Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        obstacles[i].update();
        obstacles[i].draw();
        if (obstacles[i].x + obstacles[i].width < 0) {
            obstacles.splice(i, 1);
        }
    }

    // Update & Draw Boosts
    for (let i = boosts.length - 1; i >= 0; i--) {
        boosts[i].update();
        boosts[i].draw();
        if (boosts[i].x + boosts[i].width < 0) {
            boosts.splice(i, 1);
        }
    }

    player.update();
    player.draw();
    handleCollisions();

    // UI Updates
    scoreDisplay.innerText = `Счет: ${score}`;
    
    frames++;
    if (isPlaying) {
        animationId = requestAnimationFrame(animate);
    }
}

// Input Handling
function handleInput(e) {
    if (e.type === 'touchstart' || e.type === 'mousedown') {
        // Prevent default if targeting canvas so it doesn't do ghost clicks
        if (e.target === canvas) {
            e.preventDefault();
            if (isPlaying) {
                player.jump();
            }
        }
    }
}

canvas.addEventListener('mousedown', handleInput);
canvas.addEventListener('touchstart', handleInput, {passive: false});

// Buttons
btnStart.addEventListener('click', initGame);
btnRestart.addEventListener('click', initGame);

btnShare.addEventListener('click', () => {
    const text = `Я летел в интернете и пережил ${stats.captchas} капч, ${stats.ads} реклам казино и ${stats.geoblocks} геоблоков!\nПопробуй побить мой рекорд: https://github.com/uboost-runner`; // URL to be updated
    
    if (tg && tg.switchInlineQuery) {
        tg.switchInlineQuery(text, ['users', 'groups']);
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Текст скопирован! Отправь друзьям.');
        });
    }
});

btnUboost.addEventListener('click', () => {
    if (tg && tg.openLink) {
        tg.openLink('https://uboost.vpn/store');
    } else {
        window.open('https://uboost.vpn/store', '_blank');
    }
});
