import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Database } from "@jsprismarine/leveldb";
import { unzipSync } from "fflate";
import { Block, BLOCKS } from "@/lib/blocks";
import { decodeSubchunk } from "@/lib/chunk-mesh";
import { chunkKey, TAG_BLOCK_ENTITY, TAG_SUBCHUNK, localIndex } from "@/lib/chunk";
import { readNamedCompound } from "@/lib/read-nbt";
import { HOUSE_STYLES, STYLE_TIERS } from "./catalog";
import { generateHouse } from "./generate";
import { packHouse } from "./pack";

test("every compatible style and tier keeps the furnished blocks and a clear spawn", () => {
  for (const [style, tiers] of Object.entries(STYLE_TIERS) as [keyof typeof STYLE_TIERS, (typeof STYLE_TIERS)[keyof typeof STYLE_TIERS]][]) {
    for (const price of tiers) for (const seed of [0, 9, 17, 71, 0xffffffff]) {
      const house = generateHouse({ style, price, seed });
      assert.equal(house.style, style);
      assert.equal(house.price, price);
      const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
      const cells = new Map(house.blocks.map(({ x, y, z, block }) => [key(x, y, z), block]));
      assert.equal(cells.size, house.blocks.length);
      assert.ok(cells.has(key(house.spawn.x, -1, house.spawn.z)));
      assert.ok(!cells.has(key(house.spawn.x, 0, house.spawn.z)));
      assert.ok(!cells.has(key(house.spawn.x, 1, house.spawn.z)));
      assert.equal(house.beds.length / 2, house.plan.volumes.filter(v => v.use === "Bedroom").reduce((sum, v) => sum + v.stories, 0));
      for (const bed of house.beds) {
        assert.ok([Block.BedHead, Block.BedFoot].some((block) => block === cells.get(key(bed.x, bed.y, bed.z))));
      }
      for (const chest of house.chests) {
        assert.equal(cells.get(key(chest.x, chest.y, chest.z)), Block.Chest);
        assert.equal(cells.get(key(chest.x, chest.y + 1, chest.z)), undefined);
        assert.ok(chest.items.length > 0);
      }
      const diamonds = house.chests.some((chest) => chest.items.some(({ name }) => name === "minecraft:diamond"));
      assert.equal(diamonds, price === "luxury");
      if (style === "manufactured") {
        assert.equal(house.floors.length, 1);
        assert.doesNotMatch(house.specs, /garage/i);
        assert.ok(house.chests.length > 0);
        const trailerAllowed = new Set([
          "minecraft:rotten_flesh", "minecraft:potato", "minecraft:bowl", "minecraft:bread",
          "minecraft:stick", "minecraft:wooden_pickaxe", "minecraft:cobblestone", "minecraft:wooden_shovel",
          "minecraft:string", "minecraft:feather", "minecraft:paper", "minecraft:leather_boots",
          "minecraft:cod", "minecraft:coal", "minecraft:flint", "minecraft:bone", "minecraft:copper_ingot",
        ]);
        for (const chest of house.chests) {
          for (const item of chest.items) assert.ok(trailerAllowed.has(item.name), `unexpected trailer loot: ${item.name}`);
        }
      }
      const h = style === "pnw_modern" || style === "pnw_lodge" ? 5 : 4;
      for (const b of house.blocks) {
        if (b.block !== Block.Glowstone && b.block !== Block.SeaLantern) continue;
        const inCeiling = b.y % h === 0;
        const inWall = house.plan.volumes.some((v) =>
          (b.x === v.x || b.x === v.x + v.w - 1 || b.z === v.z || b.z === v.z + v.d - 1) &&
          b.x >= v.x && b.x < v.x + v.w && b.z >= v.z && b.z < v.z + v.d
        );
        assert.ok(inCeiling || inWall, `${style} ${price} seed ${seed}: light at (${b.x},${b.y},${b.z}) protrudes into room`);
      }
    }
  }
});

test("seeds reproduce the preview and sample the full Coeur d’Alene mix", () => {
  const rolled = generateHouse({ seed: 40317 });
  assert.deepEqual(generateHouse(rolled.request), rolled);
  assert.notDeepEqual(generateHouse({ seed: 40318 }).blocks, rolled.blocks);
  const styles = new Set(Array.from({ length: 80 }, (_, seed) => generateHouse({ seed }).style));
  assert.deepEqual([...styles].sort(), Object.keys(HOUSE_STYLES).filter((style) => style !== "any").sort());
});

test("the Bedrock archive preserves beds and every named chest inventory", async () => {
  const house = generateHouse({ style: "pnw_modern", era: "contemporary", price: "luxury", seed: 40317 });
  const files = unzipSync(await packHouse(house));
  const level = readNamedCompound(Buffer.from(files["level.dat"]), 8).value;
  assert.equal(level.SpawnX, house.spawn.x);
  assert.equal(level.SpawnY, house.spawn.y);
  assert.equal(level.SpawnZ, house.spawn.z);
  assert.equal(level.RandomSeed, BigInt(house.seed));

  const root = await mkdtemp(path.join(tmpdir(), "cda-house-test-"));
  try {
    const dir = path.join(root, "db");
    await mkdir(dir);
    await Promise.all(Object.entries(files).filter(([name]) => name.startsWith("db/")).map(([name, bytes]) => writeFile(path.join(root, name), bytes)));
    const db = await Database.open(dir);
    try {
      const room=house.plan.volumes[0];
      const ceiling={x:room.x+Math.floor(room.w/2),y:room.stories*5,z:room.z+Math.floor(room.d/2)};
      const section=db.get(chunkKey(Math.floor(ceiling.x/16),Math.floor(ceiling.z/16),TAG_SUBCHUNK,Math.floor(ceiling.y/16)));
      assert.ok(section);
      const decoded=decodeSubchunk(section,Math.floor(ceiling.y/16));
      const expected=house.blocks.find(b=>b.x===ceiling.x&&b.y===ceiling.y&&b.z===ceiling.z)!;
      assert.ok(expected,'preview ceiling exists');
      assert.equal(decoded?.get(localIndex(ceiling.x,ceiling.y,ceiling.z)+(ceiling.y<<16)),BLOCKS[expected.block].name,'ceiling survives world export');
      const chunks = new Map([...house.beds, ...house.chests].map(({ x, z }) => {
        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        return [`${cx},${cz}`, chunkKey(cx, cz, TAG_BLOCK_ENTITY)] as const;
      }));
      const tags = [...chunks.values()].flatMap((key) => {
        const raw = db.get(key);
        assert.ok(raw);
        const entities = [];
        for (let offset = 0; offset < raw.length;) {
          const tag = readNamedCompound(raw, offset);
          entities.push(tag.value);
          offset = tag.offset;
        }
        return entities;
      });
      assert.equal(tags.length, house.beds.length + house.chests.length);
      for (const chest of house.chests) {
        const tag = tags.find(({ id, x, y, z }) => id === "Chest" && x === chest.x && y === chest.y && z === chest.z);
        assert.ok(tag);
        assert.equal(tag.CustomName, chest.label);
        assert.deepEqual(tag.Items, chest.items.map((item, Slot) => ({ Name: item.name, Damage: 0, Count: item.count, Slot })));
      }
      for (const bed of house.beds) {
        assert.ok(tags.some(({ id, x, y, z }) => id === "Bed" && x === bed.x && y === bed.y && z === bed.z));
      }
    } finally {
      await db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("same-style seeds change footprint topology, room program, and roof composition", () => {
  for (const style of Object.keys(STYLE_TIERS) as (keyof typeof STYLE_TIERS)[]) {
    const houses = Array.from({ length: 32 }, (_, seed) => generateHouse({ style, seed, price: STYLE_TIERS[style][0] }));
    // Manufactured homes deliberately trade footprint variety for a credible single chassis.
    assert.ok(new Set(houses.map(h => h.plan.signature)).size >= (style === "manufactured" ? 20 : 30), style);
    assert.ok(new Set(houses.map(h => h.plan.family)).size >= (style === "manufactured" ? 1 : style === "suburban" ? 2 : 3), style);
    const graph = (h: typeof houses[number]) => h.plan.connections.map(c => `${c.a}-${c.b}-${c.side}`).join("/");
    // Hall-based grammars deliberately restrict adjacency: bedrooms must not
    // become through-routes merely to increase the number of unique graphs.
    if (!["manufactured", "suburban", "ranch", "craftsman", "farmhouse"].includes(style)) assert.ok(new Set(houses.map(graph)).size >= 8, style);
    for (const house of houses) {
      assert.equal(house.plan.connections.length, house.plan.volumes.length - 1);
      for (const a of house.plan.volumes) for (const b of house.plan.volumes) if (a.id < b.id) {
        const overlapX = Math.min(a.x + a.w - 1, b.x + b.w - 1) - Math.max(a.x, b.x);
        const overlapZ = Math.min(a.z + a.d - 1, b.z + b.d - 1) - Math.max(a.z, b.z);
        assert.ok(overlapX <= 0 || overlapZ <= 0, "overlapping room interiors");
      }
    }
  }
});

test('ground-floor circulation connects every room without moving furniture', () => {
  for (const style of Object.keys(STYLE_TIERS) as (keyof typeof STYLE_TIERS)[]) for (let seed=0;seed<(style==='craftsman'?120:25);seed++) {
    const house=generateHouse({style,seed});
    const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
    const cells=new Map(house.blocks.map(b=>[key(b.x,b.y,b.z),b.block]));
    const doors:number[]=[Block.OakDoorLower,Block.OakDoorUpper,Block.OakDoorEastLower,Block.OakDoorEastUpper];
    const open=(x:number,z:number)=>[1,2].every(y=>!cells.has(key(x,y,z))||doors.includes(cells.get(key(x,y,z))!));
    const floor=(x:number,z:number)=>house.plan.volumes.some(v=>x>=v.x&&x<v.x+v.w&&z>=v.z&&z<v.z+v.d);
    const queue=[house.plan.entry],seen=new Set<string>();
    for(let i=0;i<queue.length;i++) {
      const {x,z}=queue[i],id=`${x},${z}`;
      if(seen.has(id)||!floor(x,z)||!open(x,z)) continue;
      seen.add(id);queue.push({x:x+1,z},{x:x-1,z},{x,z:z+1},{x,z:z-1});
    }
    for(const v of house.plan.volumes) assert.ok(seen.has(`${Math.floor(v.x+v.w/2)},${Math.floor(v.z+v.d/2)}`),`${style} seed ${seed}: unreachable ${v.use}`);
  }
});

test('roof planning can change independently and combine rooms without covering courtyards', async () => {
  const { planRoofs } = await import('./roofs');
  const house=generateHouse({style:'pnw_modern',price:'luxury',seed:4});
  const before=JSON.stringify(house.plan.volumes);
  const flat=planRoofs(house.plan.volumes,'pnw_modern',()=>0);
  const shed=planRoofs(house.plan.volumes,'pnw_modern',()=>0.99);
  assert.notDeepEqual(flat,shed);
  assert.equal(JSON.stringify(house.plan.volumes),before);
  assert.deepEqual(flat.map(r=>[r.x,r.z,r.w,r.d]),shed.map(r=>[r.x,r.z,r.w,r.d]));
  const rooms=[
    {id:0,x:0,z:0,w:8,d:8,use:'Living room' as const,stories:1},
    {id:1,x:7,z:0,w:8,d:8,use:'Bedroom' as const,stories:1},
    {id:2,x:0,z:7,w:8,d:8,use:'Kitchen / dining' as const,stories:1},
  ];
  const roofs=planRoofs(rooms,'ranch',()=>0);
  assert.equal(roofs.length,2);
  assert.ok(roofs.some(r=>r.rooms.length===2));
  assert.ok(!roofs.some(r=>12>r.x&&12<r.x+r.w&&12>r.z&&12<r.z+r.d));
});


test('style silhouettes have bounded roof complexity and trailers remain rectangular', async () => {
  const { ARCHITECTURE } = await import('./architecture');
  for (const style of Object.keys(STYLE_TIERS) as (keyof typeof STYLE_TIERS)[]) {
    for (const price of STYLE_TIERS[style]) for (let seed=0;seed<50;seed++) {
      const house=generateHouse({style,price,seed});
      const plan=house.plan;
      assert.ok(plan.roofs.length + Number(plan.porchCanopy) <= ARCHITECTURE[style].maxRooflines, style);
      assert.ok(plan.envelopes.length <= ARCHITECTURE[style].maxBodies);
      for (const body of plan.envelopes) {
        for(let x=body.x;x<body.x+body.w;x++) for(let z=body.z;z<body.z+body.d;z++) {
          assert.ok(body.rooms.some(id=>{const v=plan.volumes[id];return x>=v.x&&x<v.x+v.w&&z>=v.z&&z<v.z+v.d;}), 'empty space inside a building body');
        }
      }
      if(style==='manufactured') {
        assert.equal(plan.roofs.length,1);
        assert.equal(plan.roofs[0].roof,'shallow');
        assert.equal(plan.roofs[0].ridge,'x');
        assert.equal(plan.porchCanopy,false);
        assert.equal(plan.envelopes.length,1);
        assert.ok(plan.volumes.length>1);
      }
    }
  }
});


test('suburban proposals preserve private rooms, hierarchy and distinct circulation plans', async () => {
  const {reviewSuburban}=await import('./suburban');
  const {generateHouseBatch}=await import('./batch');
  const orientations=new Set<string>();
  for(let seed=0;seed<100;seed++) {
    const h=generateHouse({style:'suburban',price:'mid',seed});
    assert.deepEqual(reviewSuburban(h.plan).issues,[]);
    const hall=h.plan.volumes.find(v=>v.use==='Hallway')!;
    orientations.add(hall.w>hall.d?'cross hall':'long hall');
    for(const roof of h.plan.roofs) assert.ok(roof.pitch>=2);
    assert.ok(h.blocks.some(b=>b.block===Block.RoofSlab));
    assert.ok(h.blocks.every(b=>Number.isInteger(b.x)&&Number.isInteger(b.y)&&Number.isInteger(b.z)));
  }
  assert.equal(orientations.size,2);
  const batch=generateHouseBatch({style:'suburban',price:'mid',era:'suburban90s',seed:4});
  assert.equal(batch.length,6);
  assert.ok(new Set(batch.map(h=>h.plan.family)).size>=3);
  assert.ok(batch.every(h=>h.style==='suburban'&&h.price==='mid'&&h.era==='suburban90s'));
  assert.deepEqual(batch,generateHouseBatch({style:'suburban',price:'mid',era:'suburban90s',seed:4}));
});


test('top-floor rooms have continuous ceilings beneath the roof in every style', () => {
  for(const style of Object.keys(STYLE_TIERS) as (keyof typeof STYLE_TIERS)[]) for(let seed=0;seed<30;seed++) {
    const house=generateHouse({style,seed});
    const h=style==='pnw_modern'||style==='pnw_lodge'?5:4;
    const cells=new Map(house.blocks.map(b=>[`${b.x},${b.y},${b.z}`,b.block]));
    for(const room of house.plan.volumes) {
      for(let x=room.x;x<room.x+room.w;x++) for(let z=room.z;z<room.z+room.d;z++) {
        assert.ok(cells.has(`${x},${room.stories*h},${z}`),`${style} seed ${seed}: open ceiling over ${room.use}`);
      }
    }
    const upper=house.floors[1];
    if(upper) {
      const main=house.plan.volumes.find(v=>v.use==='Living room'&&v.stories===2)!;
      assert.ok(house.blocks.some(b=>b.block===Block.OakStairWest&&b.y===upper.floorY&&b.x>main.x&&b.x<main.x+main.w&&b.z>main.z&&b.z<main.z+main.d));
    }
  }
});

test('ranches keep a low silhouette and connect private rooms to halls', () => {
  const families=new Set<string>();
  const doors=new Set<string>();
  for(const price of STYLE_TIERS.ranch) for(let seed=0;seed<60;seed++) {
    const house=generateHouse({style:'ranch',price,seed});
    const plan=house.plan;
    families.add(plan.family);
    assert.equal(house.floors.length,1);
    assert.equal(house.chests.length,2);
    assert.ok(plan.roofs.length<=2);
    assert.ok(plan.roofs.every(r=>r.pitch>=3));
    assert.ok(house.blocks.some(b=>b.block===Block.RoofSlab));
    for(const room of plan.volumes.filter(v=>v.use==='Bedroom'||v.use==='Bathroom')) {
      const links=plan.connections.filter(c=>c.a===room.id||c.b===room.id);
      assert.equal(links.length,1);
      const link=links[0];
      assert.equal(plan.volumes[link.a===room.id?link.b:link.a].use,'Hallway');
    }
    if(plan.garageDoor) {
      const {x,z,dx,dz,side}=plan.garageDoor;
      doors.add(side?'side':'front');
      assert.ok(house.blocks.some(b=>b.x===x+dx*3&&b.z===z+dz*3&&b.y===-1&&b.block===Block.GrayConcrete));
    }
  }
  assert.equal(families.size,4);
  assert.equal(doors.size,2);
});

test('Craftsman compositions keep porches usable, bedrooms private, and both floors connected', async () => {
  const {generateHouseBatch}=await import('./batch');
  const families=new Set<string>(),hallAxes=new Set<string>(),porchForms=new Set<string>();
  const doors:number[]=[Block.OakDoorLower,Block.OakDoorUpper,Block.OakDoorEastLower,Block.OakDoorEastUpper];
  for(const price of STYLE_TIERS.craftsman) for(let seed=0;seed<100;seed++) {
    const house=generateHouse({style:'craftsman',price,seed}),plan=house.plan,p=plan.porch!;
    const context=`${price} seed ${seed}: ${plan.family}`;
    families.add(plan.family);porchForms.add(p.roof);
    const hall=plan.volumes.find(v=>v.use==='Hallway')!;
    hallAxes.add(hall.w>hall.d?'cross':'long');
    assert.equal(plan.roofs.length,2,context);
    assert.ok(plan.roofs.every(r=>r.roof==='gable'&&r.pitch===2),context);
    assert.ok(plan.porchCanopy&&p.w>=8&&p.d>=3,context);
    assert.ok(house.blocks.every(b=>Number.isInteger(b.x)&&Number.isInteger(b.y)&&Number.isInteger(b.z)),context);
    const cells=new Map(house.blocks.map(b=>[`${b.x},${b.y},${b.z}`,b.block]));
    for(const room of plan.volumes.filter(v=>v.use==='Bedroom'||v.use==='Bathroom')) {
      const links=plan.connections.filter(c=>c.a===room.id||c.b===room.id);
      assert.equal(links.length,1,context);
      const c=links[0];assert.equal(plan.volumes[c.a===room.id?c.b:c.a].use,'Hallway',context);
    }
    // A three-block-wide walk cannot collide with stone piers or porch furniture.
    for(let x=plan.entry.x-1;x<=plan.entry.x+1;x++) for(let z=1;z<=p.z+p.d;z++) for(const y of [1,2]) {
      assert.equal(cells.get(`${x},${y},${z}`),undefined,`${context}: obstructed porch walk`);
    }
    const garage=plan.volumes.find(v=>v.use==='Garage')!,bay=plan.garageDoor!;
    for(let n=1;n<=6;n++) for(let dx=-2;dx<=2;dx++) {
      assert.equal(cells.get(`${bay.x+dx},-1,${bay.z+n}`),Block.GrayConcrete,context);
      assert.ok(!plan.volumes.some(v=>v!==garage&&bay.x+dx>=v.x&&bay.x+dx<v.x+v.w&&bay.z+n>=v.z&&bay.z+n<v.z+v.d),context);
    }
    if(house.floors.length===2) {
      const living=plan.volumes[0],queue=[{x:living.x+1,z:living.z+2}],seen=new Set<string>();
      for(let i=0;i<queue.length;i++) {
        const {x,z}=queue[i],k=`${x},${z}`;
        if(seen.has(k)||!plan.volumes.some(v=>v.stories===2&&x>=v.x&&x<v.x+v.w&&z>=v.z&&z<v.z+v.d)) continue;
        if(![5,6].every(y=>!cells.has(`${x},${y},${z}`)||doors.includes(cells.get(`${x},${y},${z}`)!))) continue;
        seen.add(k);queue.push({x:x+1,z},{x:x-1,z},{x,z:z+1},{x,z:z-1});
      }
      for(const v of plan.volumes.filter(v=>v.stories===2)) assert.ok(seen.has(`${Math.floor(v.x+v.w/2)},${Math.floor(v.z+v.d/2)}`),`${context}: unreachable upstairs ${v.use}`);
    }
  }
  assert.equal(families.size,4);assert.equal(hallAxes.size,2);assert.equal(porchForms.size,2);
  const batch=generateHouseBatch({style:'craftsman',price:'mid',seed:4});
  assert.equal(new Set(batch.map(h=>h.plan.family)).size,4);
});

test("Modern farmhouses split into a 1-story entry half, a 2-story stair half, and North Idaho white-and-timber theme", () => {
  const families = new Set<string>();
  const doors: number[] = [Block.OakDoorLower, Block.OakDoorUpper, Block.OakDoorEastLower, Block.OakDoorEastUpper];
  const farmhouseWalls = new Set<number>([Block.WhiteConcrete, Block.WhiteTerracotta, Block.Quartz]);
  for (const price of STYLE_TIERS.farmhouse) {
    for (let seed = 0; seed < 50; seed++) {
      const house = generateHouse({ style: "farmhouse", price, seed });
      const plan = house.plan;
      families.add(plan.family);
      assert.ok(farmhouseWalls.has(house.materials.wall));

      assert.equal(house.floors.length, 2, `${price} seed ${seed}: must be 2 stories`);
      assert.equal(plan.envelopes.length, 2, `${price} seed ${seed}: must have 2 distinct halves`);
      assert.equal(plan.envelopes[0].stories, 1, `${price} seed ${seed}: entry half must be 1 story`);
      assert.equal(plan.envelopes[1].stories, 2, `${price} seed ${seed}: opposite half must be 2 stories`);
      assert.ok(plan.envelopes[0].rooms.includes(0), `${price} seed ${seed}: entry room must be in the 1-story half`);
      assert.ok(plan.envelopes[0].z !== plan.envelopes[1].z || plan.envelopes[0].d !== plan.envelopes[1].d, "must not be one flat rectangle");

      const living = plan.volumes.find((v) => v.use === "Living room" && v.stories === 2)!;
      assert.ok(living && plan.envelopes[1].rooms.includes(living.id), "2-story living room with stairs must be in opposite half");

      // Verify upstairs rooms are all reachable from the stair landing
      const cells = new Map(house.blocks.map((b) => [`${b.x},${b.y},${b.z}`, b.block]));
      const queue = [{ x: living.x + 1, z: living.z + 2 }];
      const seen = new Set<string>();
      for (let i = 0; i < queue.length; i++) {
        const { x, z } = queue[i], k = `${x},${z}`;
        if (seen.has(k) || !plan.volumes.some((v) => v.stories === 2 && x >= v.x && x < v.x + v.w && z >= v.z && z < v.z + v.d)) continue;
        if (![5, 6].every((y) => !cells.has(`${x},${y},${z}`) || doors.includes(cells.get(`${x},${y},${z}`)!))) continue;
        seen.add(k);
        queue.push({ x: x + 1, z }, { x: x - 1, z }, { x, z: z + 1 }, { x, z: z - 1 });
      }
      for (const v of plan.volumes.filter((r) => r.stories === 2)) {
        assert.ok(seen.has(`${Math.floor(v.x + v.w / 2)},${Math.floor(v.z + v.d / 2)}`), `${price} seed ${seed}: unreachable upstairs ${v.use}`);
      }
    }
  }
  assert.equal(families.size, 4);
});
