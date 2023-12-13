import {
  Scene,
  WebGLRenderer,
  ShaderMaterial,
  OrthographicCamera,
  AmbientLight,
  Mesh,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  Clock,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from './shaders/vignette';
import type { World } from '@dimforge/rapier2d';
import { getRapier, Rapier } from './physics/rapier';
import Stats from 'stats.js';

import { Wavefront, Map, Sound } from './lib';
import { EventSource, ResourcePool } from './lib';

import toonVertexShader from './shaders/toon.vert?raw'
import toonFragmentShader from './shaders/toon.frag?raw'

import tone from './sounds/tone.wav'
import toneReverb from './sounds/tone-reverb.wav'

// Set up FPS stats
const stats = new Stats()
stats.showPanel(0)
document.body.appendChild(stats.dom)

/** Contains the three.js renderer and handles to important resources. */
export class Engine {
  public readonly scene = new Scene();
  public readonly camera: OrthographicCamera;
  public readonly renderer: WebGLRenderer;
  public readonly composer: EffectComposer;
  public readonly pool = new ResourcePool();
  public readonly viewPosition = new Vector3();
  public viewAngle = 0;
  public readonly update = new EventSource<{ update: number }>();

  public rapier!: Rapier;
  private physicsWorld!: World;
  private eventQueue: any;

  private mount: HTMLElement | undefined;
  private frameId: number | null = null;
  private clock = new Clock();

  public map: Map | undefined = undefined;
  public wavefronts: { [key: string]: Wavefront } = {};

  // Renderer setup
  private frustumSize = 50;
  private aspect = window.innerWidth / window.innerHeight;

  // Cursor setup
  private cursorMesh?: Mesh;
  private cursorPos: Vector3;
  private cursorDisplacement: number = 0;

  private viewOffset = new Vector2(0, 0);
  public mousePos = new Vector2(0, 0);

  // Audio Setup
  private defaultTone: Sound;
  private defaultToneReverb: Sound;

  constructor() {
    // Set up renderer scene
    this.animate = this.animate.bind(this);
    this.camera = new OrthographicCamera(
      this.frustumSize * this.aspect / - 2,
      this.frustumSize * this.aspect / 2,
      this.frustumSize / 2,
      this.frustumSize / - 2, 0.1, 100
    );
    this.camera.position.set(0, 0, 1);
    this.camera.updateMatrixWorld();

    this.renderer = this.createRenderer();
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(window.innerWidth, window.innerHeight);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), .25, .5, 0.0);
    this.composer.addPass(bloomPass);

    let vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms["resolution"].value = new Vector2(window.innerWidth, window.innerHeight);
    this.composer.addPass(vignettePass);

    const afterimagePass = new AfterimagePass(.35);
    this.composer.addPass(afterimagePass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    this.cursorPos = new Vector3(0, 0, 0);

    // Set up sound
    this.defaultTone = new Sound(tone);
    this.defaultToneReverb = new Sound(toneReverb);
  }

  public loadSounds() {
    return Promise.all([
      this.defaultTone.load(),
      this.defaultToneReverb.load()
    ]);
  }

  /** Shut down the renderer and release all resources. */
  public dispose() {
    this.pool.dispose();
  }

  /** Attach the renderer to the DOM. */
  public async attach(mount: HTMLElement) {
    this.mount = mount;
    window.addEventListener('resize', this.onWindowResize.bind(this));
    mount.appendChild(this.renderer.domElement);
    this.onWindowResize();

    // Make sure physics WASM bundle is initialized before starting rendering loop.
    // Physics objects cannot be created until after physics engine is initialized.
    this.rapier = (this.rapier = await getRapier());

    // Create physics
    const gravity = { x: 0, y: 0 };
    this.physicsWorld = new this.rapier.World(gravity);
    // To avoid leaking WASM resources, this MUST be freed manually with eventQueue.free() once you are done using it.
    this.eventQueue = new this.rapier.EventQueue(true);

    // Create cursor
    const cursorMaterial = new ShaderMaterial({
      uniforms: {
        color:
          { value: new Vector4(1.0, 1.0, 1.0, 1.0) }
      },
      vertexShader: toonVertexShader,
      fragmentShader: toonFragmentShader,
    })
    const cursorGeometry = new SphereGeometry(.4, 5);
    this.cursorMesh = new Mesh(cursorGeometry, cursorMaterial);
    this.scene.add(this.cursorMesh)

    // Add world map after sounds are loaded
    this.loadSounds().then(values => {
      this.map = new Map(this.rapier, this.physicsWorld, this.scene, this.defaultToneReverb);
    });

    const ambientLight = new AmbientLight('white', 20.0);
    this.scene.add(ambientLight);

    if (!this.frameId) {
      this.clock.start();
      this.frameId = requestAnimationFrame(this.animate);
    }
  }

  /** Detach the renderer from the DOM. */
  public detach() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    window.removeEventListener('resize', this.onWindowResize);
    this.mount?.removeChild(this.renderer.domElement);
  }

  /** Update the positions of any moving objects. */
  public updateScene(deltaTime: number) {
    // Run callbacks.
    this.update.emit('update', deltaTime);

    // Run physics 
    this.physicsWorld?.step(this.eventQueue);

    // Check for collision events
    this.eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
      let mapPointType;
      let wavefrontDetune = 0;
      let wavefrontPointAge = 0;
      let wavefrontPointLifespan = 1;

      for (const [key, wavefront] of Object.entries(this.wavefronts)) {
        wavefrontDetune = wavefront.detune;
        wavefront.points.forEach((point) => {
          if (point.handle == handle1 || point.handle == handle2) {
            point.state = 'collided';
            point.needsUpdate = true;
            wavefrontPointAge = point.age;
            wavefrontPointLifespan = point.lifespan;
          }
        });
      }

      const volume = Math.max(.6 - Math.sqrt(wavefrontPointAge / wavefrontPointLifespan), 0);

      this.map?.mapPoints.forEach((point) => {
        if (point.handle == handle1 || point.handle == handle2) {
          point.setState('collided');
          point.clock.start();
          mapPointType = point.type;
          // TODO: set pan
          point.playReflectedSound(volume, wavefrontDetune)
        }
      })
    });

    // Update environment and wavefronts
    this.map?.update()

    for (const [key, wavefront] of Object.entries(this.wavefronts)) {
      wavefront.update();
      for (const [key, point] of Object.entries(wavefront.points)) {
        if (point.age > wavefront.lifespan) {
          point.remove(this.physicsWorld!, this.scene);
          delete wavefront.points[key as unknown as number];
        }
      }
      if (wavefront.points.length == 0) {
        wavefront.remove(this.scene, this.physicsWorld!);
        delete this.wavefronts[key];
      }
    }

    // Update camera and cursor positions
    this.updateCameraPos();
  }

  public updateMousePos(mouse: { x: number, y: number }) {
    this.mousePos.set(mouse.x, mouse.y);
  }

  public updateCameraPos() {
    // Make the camera follow the cursor with damping
    const acceleration = this.mousePos.length() ** 4;
    const normal = this.mousePos.clone().normalize().multiplyScalar(acceleration * 10)
    this.viewOffset.add(normal);

    // Add a subtle pan depending on where the cursor is
    const mousePosWorld = new Vector2(this.mousePos.x * window.innerWidth / 8, this.mousePos.y * window.innerHeight / 8);
    const swayOffset = mousePosWorld.add(this.viewOffset.clone().negate()).multiplyScalar(.1);

    // Adjust camera offset to simulate panning
    this.camera.setViewOffset(window.innerWidth, window.innerHeight, this.viewOffset.x + swayOffset.x, -this.viewOffset.y - swayOffset.y, window.innerWidth, window.innerHeight)
    this.camera.updateProjectionMatrix();

    // Move the game cursor with linear interpolation and offset its position to account for damping
    let zoomFactor = .5 / this.camera.zoom * this.frustumSize;
    const targetCursorPos = new Vector3((this.mousePos.x * this.aspect + (this.viewOffset.x + swayOffset.x) / 395) * zoomFactor, (this.mousePos.y + (this.viewOffset.y + swayOffset.y) / 395) * zoomFactor, 0.0);
    this.cursorPos.x = this.lerp(this.cursorPos.x, targetCursorPos.x, 0.15);
    this.cursorPos.y = this.lerp(this.cursorPos.y, targetCursorPos.y, 0.15);
    this.cursorMesh?.position.copy(this.cursorPos);

    const cursorPosDelta = Math.sqrt((this.cursorPos.x - targetCursorPos.x) ** 2 + (this.cursorPos.y - targetCursorPos.y) ** 2);
    this.cursorDisplacement += cursorPosDelta;
    let cursorExpression = 1 + (.3 + cursorPosDelta * .02) * Math.sin(this.cursorDisplacement / 7);
    cursorExpression = this.lerp(cursorExpression, .6, 0.15);

    this.cursorMesh?.scale.set(cursorExpression, cursorExpression, cursorExpression);
  }

  public fireClickEvent() {
    const lifespan = 2;
    const wavefront = new Wavefront(lifespan, this.cursorPos, this.defaultTone);
    wavefront.attach(this.rapier, this.physicsWorld!, this.scene);
    wavefront.playSoundEmission();
    this.wavefronts[this.time.toString()] = wavefront
  }

  /** Return the elapsed running time. */
  public get time(): number {
    return this.clock.elapsedTime;
  }

  private lerp(start: number, end: number, amt: number) {
    return (1 - amt) * start + amt * end
  }

  private animate() {
    const deltaTime = Math.min(this.clock.getDelta(), 0.1);
    this.updateScene(deltaTime);
    this.render();
    this.frameId = window.requestAnimationFrame(this.animate);
    stats.update()
  }

  /** Render the scene. */
  public render() {
    this.composer.render();
  }

  /** Handle window resize event. */
  private onWindowResize() {
    if (this.mount) {
      const width = this.mount.clientWidth;
      const height = this.mount.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.render(this.scene, this.camera);
    }
  }

  private createRenderer() {
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = false;
    return renderer;
  }
}

