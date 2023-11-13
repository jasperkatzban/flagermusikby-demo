import {
  BoxGeometry,
  Clock,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  Vector3,
  Vector4,
  WebGLRenderer,
  ShaderMaterial
} from 'three';
import { getRapier, Rapier } from './physics/rapier';
import { EventSource, ResourcePool } from './lib';
import toonVertexShader from './shaders/toon.vert?raw'
import toonFragmentShader from './shaders/toon.frag?raw'
import * as Stats from 'stats.js';

// Set up FPS stats
const stats = new Stats()
stats.showPanel(0)
document.body.appendChild(stats.dom)

// TODO: make this a dedicated class
type Particle = {
  handle: number,
  x: number,
  y: number,
  age: number,
  sphereBody: RigidBody,
  sphereMesh: THREE.Mesh,
  needsUpdate: boolean
}

/** Contains the three.js renderer and handles to important resources. */
export class Engine {
  public readonly scene = new Scene();
  public readonly camera: OrthographicCamera;
  public readonly renderer: WebGLRenderer;
  public readonly pool = new ResourcePool();
  public readonly viewPosition = new Vector3();
  public viewAngle = 0;
  public readonly update = new EventSource<{ update: number }>();

  public rapier!: Rapier;
  private physicsWorld?: World;
  private eventQueue: any;

  private mount: HTMLElement | undefined;
  private frameId: number | null = null;
  private clock = new Clock();

  // Renderer setup
  private frustumSize = 50;
  private aspect = window.innerWidth / window.innerHeight;
  private sunlight: DirectionalLight;
  private cursorMesh?: Mesh;
  private cursorPos: Vector3;

  // Objects setup
  private numParticles: number;
  private particleSize: number;
  private particleVelocity: number;
  private particleJitter: number;
  private particleSpawnDistance: number;
  private maxParticleAge: number;
  private particles: Array<Particle>

  constructor() {
    // Constants for physics engine
    this.numParticles = 128;
    this.particleSize = .1;
    this.particleVelocity = 10;
    this.particleJitter = 1.0;
    this.particleSpawnDistance = 0;
    this.maxParticleAge = 400;
    this.particles = [];

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

    this.sunlight = this.createSunlight();
    this.renderer = this.createRenderer();

    this.cursorPos = new Vector3(0, 0, 0);
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
    const r = (this.rapier = await getRapier());

    // Create physics
    const gravity = { x: 0, y: 0 };
    this.physicsWorld = new r.World(gravity);
    // To avoid leaking WASM resources, this MUST be freed manually with eventQueue.free() once you are done using it.
    this.eventQueue = new r.EventQueue(true);

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

    // Add world map
    this.addMap();

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
    // TODO: specify type of collision based on type of material contacted
    this.eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
      this.particles.forEach((particle) => {
        if (particle.handle == handle1 || particle.handle == handle2) {
          particle.needsUpdate = true;
        }
      })
    });

    // Update rendered wavefront positions
    this.particles.forEach((particle) => {
      // If particle is passed lifecycle, remove it from world
      if (particle.age > this.maxParticleAge) {
        // TODO: remove from physics world too
        // this.physicsWorld.removeRigidBody(particle.sphereBody);
        this.scene.remove(particle.sphereMesh);
        return;
      }

      // Update particle position in renderer
      const position = particle.sphereBody!.translation();
      particle.sphereMesh.position.set(position.x, position.y, 0);

      // Update particle scale in renderer
      const scaleDecayCoeff = .01;
      const scale = particle.sphereMesh.scale
      particle.sphereMesh.scale.set(scale.x + scaleDecayCoeff, scale.y + scaleDecayCoeff, scale.z + scaleDecayCoeff);

      // Update particle color in renderer
      const colorDecayCoeff = 1.0 / this.maxParticleAge;
      const color = particle.sphereMesh.material.uniforms.color.value;
      particle.sphereMesh.material.uniforms.color.value = new Vector4(
        color.x - colorDecayCoeff,
        color.y - colorDecayCoeff,
        color.z - colorDecayCoeff,
        color.w
      );

      // Update particle if it has collided;
      if (particle.needsUpdate) {
        // Update color in renderer
        particle.sphereMesh.material.uniforms.color.value = new Vector4(color.x, color.y, color.z + .5, color.w);

        // Update velocity
        let linVel = particle.sphereBody.linvel();
        let newX = linVel.x + this.particleJitter * (Math.random() - .5)
        let newY = linVel.y + this.particleJitter * (Math.random() - .5)
        particle.sphereBody.setLinvel(new this.rapier.Vector2(newX, newY), true);

        particle.needsUpdate = false;
      }

      particle.age += 1;
    })
  }

  public updateCursorPos(mouse: { x: number, y: number }) {
    // Make the cursor follow the mouse
    let zoomFactor = .5 / this.camera.zoom * this.frustumSize;
    this.cursorPos = new Vector3(mouse.x * this.aspect * zoomFactor, mouse.y * zoomFactor, 0.0);

    this.cursorMesh?.position.copy(this.cursorPos);
  }

  public fireClickEvent() {
    this.spawnWavefront(this.cursorPos);
  }

  public addMap() {
    // Create wall rigid body
    const rbDescWall = this.rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(0, 10)
      .setCcdEnabled(true);
    const wallBody = this.physicsWorld!.createRigidBody(rbDescWall);

    // Create wall collider
    const clDescWall = this.rapier.ColliderDesc.cuboid(20, .5)
      .setFriction(0.0)
      .setFrictionCombineRule(this.rapier.CoefficientCombineRule.Max)
      .setRestitution(1.0)
      .setCollisionGroups(0x00020001)
      .setRestitutionCombineRule(this.rapier.CoefficientCombineRule.Max)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
    this.physicsWorld!.createCollider(clDescWall, wallBody);

    // Create rendered wall
    const material = new MeshStandardMaterial({ color: 0xffff00 });
    const geometry = new BoxGeometry(40, 1);
    const wallMesh = new Mesh(geometry, material);
    wallMesh.position.set(0, 10, 0);
    this.scene.add(wallMesh)
  }

  public spawnWavefront(pos: Vector3) {
    const angleJitter = Math.random();
    // Create particles in wavefront in a circular arrangement
    for (let i = 0; i < this.numParticles; i++) {
      // Calculate initial position and velocity of particles
      const angle = (i / this.numParticles) * Math.PI * 2 + angleJitter;

      const x = pos.x + this.particleSpawnDistance * Math.sin(angle);
      const y = pos.y + this.particleSpawnDistance * Math.cos(angle);

      const xVel = this.particleVelocity * Math.sin(angle)
      const yVel = this.particleVelocity * Math.cos(angle)

      // Create physics simulation particle
      const rbDesc = this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(x, y)
        .setLinvel(xVel, yVel)
        .setCcdEnabled(true);
      const sphereBody = this.physicsWorld!.createRigidBody(rbDesc);

      // Create collider for particle
      const clDesc = this.rapier.ColliderDesc.ball(this.particleSize)
        .setFriction(0.0)
        .setFrictionCombineRule(this.rapier.CoefficientCombineRule.Max)
        .setRestitution(1.0)
        .setRestitutionCombineRule(this.rapier.CoefficientCombineRule.Max)
        .setCollisionGroups(0x00010002)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
      this.physicsWorld!.createCollider(clDesc, sphereBody);

      // Capture unique identifier for particle body
      const handle = sphereBody.handle;

      // Create rendered particle
      const particleMaterial = new ShaderMaterial({
        uniforms: {
          color:
            { value: new Vector4(1.0, 1.0, 1.0, 1.0) }
        },
        vertexShader: toonVertexShader,
        fragmentShader: toonFragmentShader,
      })
      const geometry = new SphereGeometry(this.particleSize, 0, 5);
      const sphereMesh = new Mesh(geometry, particleMaterial);
      this.scene.add(sphereMesh)

      // Flag for if particle has reflected
      // TODO: this will likely become a more nuanced state to handle multiple reflections off of multiple surfaces
      const needsUpdate = false;

      const age = 0;

      // Add particle to global particle array
      const particle = { handle, x, y, age, sphereBody, sphereMesh, needsUpdate }
      this.particles.push(particle)
    }
  }

  /** Return the elapsed running time. */
  public get time(): number {
    return this.clock.elapsedTime;
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
    this.renderer.render(this.scene, this.camera);
  }

  /** Handle window resize event. */
  private onWindowResize() {
    if (this.mount) {
      const width = this.mount.clientWidth;
      const height = this.mount.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
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

  private createSunlight() {
    const sunlight = new DirectionalLight(new Color('#ffffff').convertSRGBToLinear(), 0.4);
    sunlight.position.set(0, 1, 1);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.width = 1024;
    sunlight.shadow.mapSize.height = 1024;
    sunlight.shadow.camera.near = 1;
    sunlight.shadow.camera.far = 32;
    sunlight.shadow.camera.left = -15;
    sunlight.shadow.camera.right = 15;
    sunlight.shadow.camera.top = 15;
    sunlight.shadow.camera.bottom = -15;
    this.scene.add(sunlight);
    return sunlight;
  }
}
