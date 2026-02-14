/**
 * 《熵减战争》 (Entropy Reduction War) - MOBA Map Layout
 * 核心升级：仿生眼型地图分布、非线性兵线、动态支援难度
 */

const CONFIG = {
  WIDTH: 1200,
  HEIGHT: 800,
  FPS: 60,
  BLOCKADE_THRESHOLD: 3000,
  // 核心参数
  LANE_CURVE: 280,        // 边路最大弯曲程度 (决定中场的宽度)
  LINK_MAX_DIST: 200,     // 网状连接的最大物理距离 (超过这个距离连不上)
  DECAY_RATE: 0.7,        // 距离衰减 (边路因为路长，衰减更狠)
  WRECKAGE_MASS: 25,
};

enum UnitType { SHIELD='🛡️', CROSSBOW='🏹', CAVALRY='🐎', TOWER='🏯' }
enum Faction { PLAYER=1, ENEMY=-1 }
enum Lane { TOP=0, MID=1, BOT=2 }

const UNIT_STATS = {
  [UnitType.SHIELD]:   { hp: 500, dmg: 8,  range: 40,  speed: 0.6, radius: 18, cost: 100, count: 3, mass: 30, color:'#3498db' },
  [UnitType.CROSSBOW]: { hp: 120, dmg: 45, range: 200, speed: 0.9, radius: 12, cost: 150, count: 4, mass: 5,  color:'#2ecc71' },
  [UnitType.CAVALRY]:  { hp: 350, dmg: 25, range: 35,  speed: 3.0, radius: 16, cost: 200, count: 2, mass: 18, color:'#e74c3c' },
  [UnitType.TOWER]:    { hp: 5000, dmg: 90, range: 280, speed: 0,   radius: 40, cost: 0,   count: 1, mass: 9999,color:'#f1c40f' }
};

const DAMAGE_MATRIX = {
  [UnitType.SHIELD]:   { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 0.5, [UnitType.TOWER]: 0.2 },
  [UnitType.CROSSBOW]: { [UnitType.SHIELD]: 0.5, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 2.0, [UnitType.TOWER]: 1.0 },
  [UnitType.CAVALRY]:  { [UnitType.SHIELD]: 2.0, [UnitType.CROSSBOW]: 1.0, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0.4 },
  [UnitType.TOWER]:    { [UnitType.SHIELD]: 1.0, [UnitType.CROSSBOW]: 1.5, [UnitType.CAVALRY]: 1.0, [UnitType.TOWER]: 0 }
};

// ==========================================
// 1. 地图几何学 (Map Geometry)
// ==========================================
class MapGeometry {
  // 获取某条路在特定X坐标的理想Y坐标
  static getLaneY(lane: Lane, x: number): number {
    const centerY = CONFIG.HEIGHT / 2;
    if (lane === Lane.MID) return centerY;

    // 归一化进度 (0~1)
    const progress = x / CONFIG.WIDTH;
    // 正弦波曲线：两头(0,1)为0，中间(0.5)最大
    const curve = Math.sin(progress * Math.PI) * CONFIG.LANE_CURVE;
    
    return lane === Lane.TOP ? centerY - curve : centerY + curve;
  }

  // 获取某位置的切线方向 (用于移动)
  static getLaneVector(lane: Lane, x: number, faction: Faction): {vx: number, vy: number} {
    const dir = faction === Faction.PLAYER ? 1 : -1;
    if (lane === Lane.MID) return { vx: dir, vy: 0 };

    const step = 10 * dir;
    const currY = this.getLaneY(lane, x);
    const nextY = this.getLaneY(lane, x + step);
    
    const dx = step;
    const dy = nextY - currY;
    const len = Math.hypot(dx, dy);
    return { vx: dx/len, vy: dy/len };
  }
}

// ==========================================
// 2. 实体系统
// ==========================================
class Wreckage {
  x: number; y: number; value: number; radius: number = 10; marked: boolean = false; mass: number = CONFIG.WRECKAGE_MASS;
  constructor(x: number, y: number, cost: number) { this.x=x; this.y=y; this.value = cost*0.6; }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle='#444'; ctx.beginPath(); ctx.arc(this.x,this.y,this.radius,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#666'; ctx.stroke(); ctx.fillStyle='#0ff'; ctx.font='10px Arial'; ctx.fillText('+',this.x-3,this.y+3);
  }
}

class Unit {
  id: number; x: number; y: number; lane: Lane;
  type: UnitType; faction: Faction;
  hp: number; maxHp: number; dmg: number;
  vx: number = 0; vy: number = 0;
  radius: number; mass: number; 
  cooldown: number = 0; dead: boolean = false; static: boolean = false;
  inNetwork: boolean = false;

  constructor(id: number, type: UnitType, faction: Faction, lane: Lane, x: number) {
    this.id = id; this.type = type; this.faction = faction; this.lane = lane;
    this.x = x; this.y = MapGeometry.getLaneY(lane, x);
    
    const s = UNIT_STATS[type];
    this.maxHp = s.hp; this.hp = s.hp; this.radius = s.radius; this.mass = s.mass;
    this.static = (s.speed === 0);
  }

  update(dt: number, units: Unit[], wrecks: Wreckage[], zones: any[]) {
    if (this.dead) return;

    // 1. 网络判定
    this.inNetwork = false;
    if (!this.static) {
        for(const z of zones) {
            if(z.faction === this.faction) {
                // 简单的点圆判定是否在连接范围内
                // 实际上是判断是否在两个塔的连线附近
                // 这里简化判定：如果单位在塔的有效Link范围内
            }
        }
        // 更简单的逻辑：只要存活的相邻塔连线存在，且自己在X区间内
        // 在 Game.update 中计算了 zones，这里直接用
        for(const z of zones) {
            if(z.faction === this.faction && this.x >= Math.min(z.x1,z.x2) && this.x <= Math.max(z.x1,z.x2)) {
                 // Y轴判定：在两条曲线之间
                 const minY = Math.min(z.y1, z.y2);
                 const maxY = Math.max(z.y1, z.y2);
                 if (this.y > minY - 50 && this.y < maxY + 50) this.inNetwork = true;
            }
        }
    }

    // 2. 属性修正 (MOBA逻辑：中路短但危险，边路长且衰减)
    // 计算路程进度而不是绝对X距离
    const progress = this.faction===Faction.PLAYER ? this.x/CONFIG.WIDTH : (CONFIG.WIDTH-this.x)/CONFIG.WIDTH;
    // 边路惩罚：如果是边路，衰减系数更大 (因为路更难走)
    const lanePenalty = this.lane === Lane.MID ? 1.0 : 0.8; 
    const entropy = Math.max(0.3, (1 - progress * CONFIG.DECAY_RATE) * lanePenalty);
    
    const buffSpd = this.inNetwork ? 1.5 : 1.0;
    this.dmg = UNIT_STATS[this.type].dmg * entropy;

    // 3. 索敌与移动
    let target = null; let minDist = Infinity;
    const range = UNIT_STATS[this.type].range * (this.inNetwork?1.2:1.0);

    for(const u of units) {
        if(u.faction !== this.faction && !u.dead) {
            const d = Math.hypot(u.x-this.x, u.y-this.y);
            if(d < minDist) { minDist = d; target = u; }
        }
    }

    if(target && minDist <= range + target.radius) {
        if(this.cooldown<=0) {
            target.takeDamage(this.dmg * DAMAGE_MATRIX[this.type][target.type]);
            this.cooldown = 60;
            if(this.type===UnitType.CAVALRY && !target.static) {
                const a = Math.atan2(target.y-this.y, target.x-this.x);
                target.vx += Math.cos(a)*8; target.vy += Math.sin(a)*8;
            }
        } else this.cooldown--;
        if(!this.static) { this.vx*=0.8; this.vy*=0.8; }
    } else {
        if(!this.static) {
            const baseSpd = UNIT_STATS[this.type].speed * buffSpd;
            // 核心移动逻辑：沿着兵线切线走
            const vec = MapGeometry.getLaneVector(this.lane, this.x, this.faction);
            
            this.vx += vec.vx * baseSpd * 0.1;
            this.vy += vec.vy * baseSpd * 0.1;

            // 强力归队力 (Magnetic Lane)
            const idealY = MapGeometry.getLaneY(this.lane, this.x);
            // 如果在网络内，允许更自由的移动(Y轴阻力小)，否则锁死在兵线
            const yStiffness = this.inNetwork ? 0.02 : 0.15;
            this.vy += (idealY - this.y) * yStiffness;

            // 速度限制
            const s = Math.hypot(this.vx, this.vy);
            if(s>baseSpd) { this.vx=(this.vx/s)*baseSpd; this.vy=(this.vy/s)*baseSpd; }
            
            this.x += this.vx; this.y += this.vy;
        }
    }

    // 4. 残骸回收
    if(!this.static) {
        for(const w of wrecks) {
            if(!w.marked && Math.hypot(w.x-this.x, w.y-this.y) < this.radius+w.radius) {
                Game.inst.addRes(this.faction, w.value); w.marked=true;
            }
        }
    }
  }

  takeDamage(n: number) {
      this.hp -= n;
      if(this.hp<=0) {
          this.dead=true;
          if(!this.static) Game.inst.spawnWreck(this.x, this.y, UNIT_STATS[this.type].cost);
          if(this.type===UnitType.TOWER) Game.inst.shake=30;
      }
  }

  draw(ctx: CanvasRenderingContext2D) {
      ctx.save(); ctx.translate(this.x, this.y);
      const scale = this.static ? 1 : 0.6 + 0.4*(this.dmg/UNIT_STATS[this.type].dmg);
      ctx.scale(scale, scale);
      
      const c = this.faction===Faction.PLAYER ? UNIT_STATS[this.type].color : (this.type===UnitType.TOWER?'#c0392b':'#7f8c8d');
      ctx.fillStyle=c; ctx.strokeStyle=c; ctx.lineWidth=2;
      
      if(this.inNetwork) { ctx.shadowBlur=15; ctx.shadowColor='#ff0'; }

      ctx.beginPath();
      if(this.type===UnitType.SHIELD) ctx.fillRect(-this.radius,-this.radius,this.radius*2,this.radius*2);
      else if(this.type===UnitType.TOWER) { 
          ctx.moveTo(0,-this.radius); ctx.lineTo(this.radius,this.radius); ctx.lineTo(-this.radius,this.radius); 
          ctx.fill();
          // 塔防范围圈
          ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.arc(0,0,200,0,Math.PI*2); ctx.stroke();
      }
      else ctx.arc(0,0,this.radius,0,Math.PI*2); ctx.fill();
      
      if(this.faction===Faction.ENEMY) ctx.stroke();
      ctx.restore();
  }
}

// ==========================================
// 3. 物理引擎
// ==========================================
class Physics {
    static update(units: Unit[], wrecks: Wreckage[]) {
        // 漏斗地形约束：现在是基于曲线的漏斗
        units.forEach(u => {
            if(u.static) return;
            const idealY = MapGeometry.getLaneY(u.lane, u.x);
            // 中场(x=600)最宽，基地最窄
            const centerDist = Math.abs(u.x - CONFIG.WIDTH/2);
            const widthFactor = 1 - (centerDist / (CONFIG.WIDTH/2)); // 0~1
            const spread = 20 + 40 * widthFactor; // 基地附近窄，中间宽
            
            if(u.y > idealY + spread) u.y = idealY + spread;
            if(u.y < idealY - spread) u.y = idealY - spread;
        });

        // 碰撞
        for(let i=0; i<units.length; i++) {
            for(let j=i+1; j<units.length; j++) {
                const u1=units[i]; const u2=units[j];
                if(u1.dead || u2.dead) continue;
                if(u1.faction===u2.faction && (u1.static || u2.static)) continue; // 友军塔穿透
                if(u1.static && u2.static) continue;

                const d = Math.hypot(u1.x-u2.x, u1.y-u2.y);
                const min = u1.radius+u2.radius;
                if(d < min) {
                    const push = (min-d)/2;
                    const nx = (u2.x-u1.x)/d; const ny = (u2.y-u1.y)/d;
                    const tm = u1.mass+u2.mass;
                    if(!u1.static) { u1.x-=nx*push*(u2.mass/tm); u1.y-=ny*push*(u2.mass/tm); }
                    if(!u2.static) { u2.x+=nx*push*(u1.mass/tm); u2.y+=ny*push*(u1.mass/tm); }
                }
            }
        }
        // 残骸阻挡
        units.forEach(u => {
            if(u.static) return;
            for(const w of wrecks) {
                if(w.marked) continue;
                const d = Math.hypot(u.x-w.x, u.y-w.y);
                const min = u.radius+w.radius;
                if(d < min) {
                    const push = min-d;
                    const nx = (u.x-w.x)/d; const ny = (u.y-w.y)/d;
                    const massRatio = w.mass / (u.mass+w.mass);
                    u.x += nx*push*massRatio; u.y += ny*push*massRatio;
                }
            }
        });
    }
}

// ==========================================
// 4. 游戏主循环
// ==========================================
class Game {
    static inst: Game;
    ctx: CanvasRenderingContext2D;
    units: Unit[]=[]; wrecks: Wreckage[]=[];
    res: number=800; score: number=0; shake: number=0; id: number=0;
    
    constructor() {
        Game.inst = this;
        const cvs = document.createElement('canvas');
        cvs.width=CONFIG.WIDTH; cvs.height=CONFIG.HEIGHT;
        document.body.appendChild(cvs);
        this.ctx = cvs.getContext('2d')!;
        this.initMap();
        this.initUI();
        this.loop();
        setInterval(()=>this.ai(), 2500);
    }

    initMap() {
        // MOBA 塔分布：
        // 基地附近三塔紧密 (高地塔)
        // 河道附近塔 (一塔) 距离极远
        const px = [100, 350]; // 塔X坐标
        const ex = [CONFIG.WIDTH-100, CONFIG.WIDTH-350];
        
        [Lane.TOP, Lane.MID, Lane.BOT].forEach(l => {
            px.forEach(x => this.units.push(new Unit(this.id++, UnitType.TOWER, Faction.PLAYER, l, x)));
            ex.forEach(x => this.units.push(new Unit(this.id++, UnitType.TOWER, Faction.ENEMY, l, x)));
        });
    }

    spawn(f: Faction, t: UnitType, l: Lane) {
        if(f===Faction.PLAYER) {
            if(this.res < UNIT_STATS[t].cost) return;
            this.res -= UNIT_STATS[t].cost;
        }
        const count = UNIT_STATS[t].count;
        const bx = f===Faction.PLAYER ? 50 : CONFIG.WIDTH-50;
        for(let i=0; i<count; i++) {
            this.units.push(new Unit(this.id++, t, f, l, bx+(Math.random()*40-20)));
        }
    }
    
    addRes(f: Faction, v: number) { if(f===Faction.PLAYER) this.res+=v; }
    spawnWreck(x: number, y: number, c: number) { this.wrecks.push(new Wreckage(x,y,c)); }

    ai() {
        const t = [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY][Math.floor(Math.random()*3)];
        const l = [Lane.TOP, Lane.MID, Lane.BOT][Math.floor(Math.random()*3)];
        this.spawn(Faction.ENEMY, t, l);
    }

    getNetworkZones() {
        // 计算连线
        const towers = this.units.filter(u => u.type===UnitType.TOWER && !u.dead);
        const zones = [];
        for(let i=0; i<towers.length; i++) {
            for(let j=i+1; j<towers.length; j++) {
                const t1=towers[i]; const t2=towers[j];
                if(t1.faction!==t2.faction) continue;
                
                const dist = Math.hypot(t1.x-t2.x, t1.y-t2.y);
                // 核心 MOBA 逻辑：
                // 只有距离小于阈值的塔才能形成连接。
                // 中场因为兵线拉开了，塔距离 > LINK_MAX_DIST，所以如果不造中间建筑(未来扩展)，
                // 这里的连接是断开的！
                if(dist < CONFIG.LINK_MAX_DIST) {
                    zones.push({faction:t1.faction, x1:t1.x, x2:t2.x, y1:t1.y, y2:t2.y});
                }
            }
        }
        return zones;
    }

    update() {
        const zones = this.getNetworkZones();
        Physics.update(this.units, this.wrecks);
        this.units.forEach(u => u.update(1, this.units, this.wrecks, zones));
        this.units = this.units.filter(u => !u.dead);
        this.wrecks = this.wrecks.filter(w => !w.marked);
        
        this.res += 0.5;
        if(this.shake>0) this.shake*=0.9;
        
        // 封锁胜利
        let deep=0;
        this.units.forEach(u=>{
            if(!u.static && u.faction===Faction.PLAYER && u.x>CONFIG.WIDTH*0.8) deep++;
            if(!u.static && u.faction===Faction.ENEMY && u.x<CONFIG.WIDTH*0.2) deep--;
        });
        if(Math.abs(deep)>2) this.score += deep;
    }

    draw() {
        const ctx = this.ctx;
        ctx.save();
        if(this.shake>1) ctx.translate(Math.random()*this.shake, Math.random()*this.shake);
        
        ctx.fillStyle='#1e272e'; ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);

        // 绘制 MOBA 地图线
        ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=40;
        [Lane.TOP, Lane.MID, Lane.BOT].forEach(l => {
            ctx.beginPath();
            for(let x=0; x<=CONFIG.WIDTH; x+=20) {
                const y = MapGeometry.getLaneY(l, x);
                if(x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
            ctx.stroke();
        });

        // 绘制连线
        const zones = this.getNetworkZones();
        zones.forEach(z => {
            ctx.strokeStyle = z.faction===Faction.PLAYER ? 'rgba(0,242,255,0.3)' : 'rgba(255,0,85,0.3)';
            ctx.lineWidth=2; ctx.setLineDash([5,5]);
            ctx.beginPath(); ctx.moveTo(z.x1,z.y1); ctx.lineTo(z.x2,z.y2); ctx.stroke();
            ctx.setLineDash([]);
        });

        this.wrecks.forEach(w => w.draw(ctx));
        this.units.forEach(u => u.draw(ctx));

        // UI
        ctx.restore();
        ctx.fillStyle='#fff'; ctx.font='20px Arial'; ctx.fillText(`Points: ${Math.floor(this.res)}`, 20, 30);
        
        const cx = CONFIG.WIDTH/2;
        ctx.fillStyle='#333'; ctx.fillRect(cx-200,30,400,10);
        const r = this.score/CONFIG.BLOCKADE_THRESHOLD;
        ctx.fillStyle = r>0?'#0ff':'#f05'; ctx.fillRect(cx,30,r*200,10);
        
        if(Math.abs(r)>=1) {
            ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.fillRect(0,0,CONFIG.WIDTH,CONFIG.HEIGHT);
            ctx.fillStyle='#fff'; ctx.font='60px Arial'; ctx.textAlign='center';
            ctx.fillText(r>0?"VICTORY":"DEFEAT", cx, CONFIG.HEIGHT/2);
        }
    }

    initUI() {
        const d = document.createElement('div');
        d.style.cssText='position:fixed;bottom:10px;left:50%;transform:translateX(-50%);display:flex;gap:20px';
        ['Top','Mid','Bot'].forEach((n,i) => {
            const g=document.createElement('div'); g.style.textAlign='center';
            g.innerHTML=`<div style="color:#888">${n}</div>`;
            [UnitType.SHIELD, UnitType.CROSSBOW, UnitType.CAVALRY].forEach(t=>{
                const b=document.createElement('button');
                b.innerText=`${t} ${UNIT_STATS[t].cost}`;
                b.onclick=()=>this.spawn(Faction.PLAYER,t,i as Lane);
                b.style.cssText='display:block;margin:5px;background:#222;color:#eee;border:1px solid #555;padding:5px;cursor:pointer';
                g.appendChild(b);
            });
            d.appendChild(g);
        });
        document.body.appendChild(d);
    }

    loop() {
        this.update(); this.draw(); requestAnimationFrame(()=>this.loop());
    }
}

new Game();
