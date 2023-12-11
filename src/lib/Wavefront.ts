import {
    Scene,
    Clock,
    Color,
    Vector3,
    Vector4,
    Mesh,
    SphereGeometry,
    ShaderMaterial,
    AudioListener,
    PositionalAudio,
    AudioLoader
} from "three";

import toonVertexShader from '../shaders/toon.vert?raw'
import toonFragmentShader from '../shaders/toon.frag?raw'

import tone from '../sounds/tone.wav'
import toneReverb from '../sounds/tone-reverb.wav'

const pitches = [0, 1.4, 3.1, 6.1, 11, 12];

export class Wavefront {
    position: Vector3;
    numPoints: number;
    pointSize: number;
    pointVelocity: number;
    positionJitter: number;
    angleJitter: number;
    pointSpawnDistance: number;
    age: number;
    lifespan: number;
    clock: Clock;

    centerMesh: Mesh;
    points: Array<WavefrontPoint> = []
    initialSound: PositionalAudio | undefined;
    playbackRate: number;

    constructor(
        lifespan: number,
        position: Vector3,
        numPoints: number = 180,
        pointSize: number = .1,
        pointVelocity: number = 13,
        positionJitter: number = .1,
        velocityJitter: number = .5,
        angleJitter: number = .05,
        pointSpawnDistance: number = 0,
    ) {
        this.position = position;
        this.numPoints = numPoints;
        this.pointSize = pointSize;
        this.pointVelocity = pointVelocity;
        this.positionJitter = positionJitter;
        this.angleJitter = angleJitter;
        this.pointSpawnDistance = pointSpawnDistance;
        this.lifespan = lifespan;



        const pitchIndex = Math.floor(Math.random() * (pitches.length - 1))
        this.playbackRate = 1 + pitches[pitchIndex] / 12;
        this.initialSound = undefined;

        this.age = 0

        // Create points in wavefront in a circular arrangement
        for (let i = 0; i < this.numPoints; i++) {

            // Calculate initial position and velocity of points
            const angleOffset = angleJitter * Math.random()
            const angle = (i / this.numPoints) * Math.PI * 2 + angleOffset;

            const radiusOffset = positionJitter * Math.random()
            const x = this.position.x + (this.pointSpawnDistance + radiusOffset) * Math.sin(angle);
            const y = this.position.y + (this.pointSpawnDistance + radiusOffset) * Math.cos(angle);

            const velocityOffset = velocityJitter * Math.random()
            const xVel = (this.pointVelocity + velocityOffset) * Math.sin(angle)
            const yVel = (this.pointVelocity + velocityOffset) * Math.cos(angle)

            const jitter = .5;

            // Add point to point array
            const point = new WavefrontPoint(x, y, xVel, yVel, pointSize, jitter, this.lifespan, this.playbackRate);
            this.points.push(point)
        }

        // Create an empty object to attach the emitted sound from
        const centerMaterial = new ShaderMaterial({
            uniforms: {
                color:
                    { value: new Vector4(0.0, 0.0, 0.0, 1.0) }
            },
            vertexShader: toonVertexShader,
            fragmentShader: toonFragmentShader,
        })

        const geometry = new SphereGeometry(0, 0, 5);
        this.centerMesh = new Mesh(geometry, centerMaterial);
        this.centerMesh.position.set(position.x, position.y, position.z);

        this.clock = new Clock();
        this.clock.start();
    }

    public attach(rapier: Rapier, physicsWorld: World, scene: Scene, listener: AudioListener) {
        this.points.forEach(point => {
            point.attach(rapier, physicsWorld, scene, listener)
        })

        // Create the PositionalAudio object (passing in the listener)
        this.initialSound = new PositionalAudio(listener);
        this.centerMesh.add(this.initialSound);

        scene.add(this.centerMesh);

        // Play initial sound when wavefront is spawned
        // this.playInitialSound();
    }

    private playInitialSound() {
        // Load and play initial tone sound
        const audioLoader = new AudioLoader();
        let sound = this.initialSound;
        const playbackRate = this.playbackRate

        audioLoader.load(tone, function (buffer) {
            sound!.setBuffer(buffer);
            sound!.setRefDistance(20);
            sound!.setPlaybackRate(playbackRate);
            sound!.play();
        });
    }

    public update() {
        this.age = this.clock.getElapsedTime();
        // Update rendered wavefront points and age
        this.points.forEach(point => {
            point.update();
        })
    }

    // TODO: specify type of collision based on type of material contacted
    public checkCollisionEvents(handle1: number, handle2: number) {
        this.points.forEach((point) => {
            if (point.handle == handle1 || point.handle == handle2) {
                point.state = 'collided';
                point.needsUpdate = true;
            }
        })
    }

    public remove(scene: Scene, physicsWorld: World) {
        // If point is passed lifecycle, remove it from world
        this.points.forEach((point) => {
            scene.remove(point.sphereMesh);
            physicsWorld.removeRigidBody(point.sphereBody);
        })
    }
}

class WavefrontPoint {
    public handle?: number;
    public state: string = 'clean';
    public needsUpdate: boolean = false;
    public x: number;
    public y: number;
    public xVel: number;
    public yVel: number;
    public pointSize: number;
    public sphereBody!: RigidBody;
    public sphereMesh!: Mesh;
    public jitter: number;
    public age: number;
    public lifespan: number;
    public playbackRate;
    public reflectedSound!: PositionalAudio;
    public clock: Clock

    constructor(x: number, y: number, xVel: number, yVel: number, pointSize: number, jitter: number, lifespan: number, playbackRate: number) {
        this.x = x;
        this.y = y;
        this.xVel = xVel;
        this.yVel = yVel;
        this.pointSize = pointSize;
        this.jitter = jitter;
        this.lifespan = lifespan
        this.playbackRate = playbackRate;
        this.age = 0;

        this.clock = new Clock();
        this.clock.start();
    }

    public attach(rapier: Rapier, physicsWorld: World, scene: Scene, listener: AudioListener) {
        // Create physics simulation point
        const rbDesc = rapier.RigidBodyDesc.dynamic()
            .setTranslation(this.x, this.y)
            .setLinvel(this.xVel, this.yVel)
            .setCcdEnabled(true);
        this.sphereBody = physicsWorld!.createRigidBody(rbDesc);

        // Create collider for point
        const clDesc = rapier.ColliderDesc.ball(this.pointSize, this.pointSize)
            // const clDesc = rapier.ColliderDesc.cuboid(this.pointSize, this.pointSize)
            .setFriction(0.0)
            .setFrictionCombineRule(rapier.CoefficientCombineRule.Max)
            .setRestitution(1.0)
            .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max)
            .setCollisionGroups(0x00010002)
            .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
        physicsWorld!.createCollider(clDesc, this.sphereBody);

        // Capture unique identifier for point body
        this.handle = this.sphereBody.handle;

        // Create rendered point
        const pointMaterial = new ShaderMaterial({
            uniforms: {
                color:
                    { value: new Vector4(1.0, 1.0, 1.0, 1.0) }
            },
            vertexShader: toonVertexShader,
            fragmentShader: toonFragmentShader,
        })

        const geometry = new SphereGeometry(this.pointSize, 0, 5);
        this.sphereMesh = new Mesh(geometry, pointMaterial);
        scene.add(this.sphereMesh)

        // Load a sound and set it as the PositionalAudio object's buffer
        this.reflectedSound = new PositionalAudio(listener);
    }

    // Load and play reflected sound upon collision
    public playReflectedSound() {
        this.reflectedSound.stop();
        const audioLoader = new AudioLoader();
        const volume = 1 - Math.sqrt(this.age / this.lifespan);
        let sound = this.reflectedSound;
        let playbackRate = this.playbackRate;

        audioLoader.load(toneReverb, function (buffer) {
            sound.setBuffer(buffer);
            sound.setRefDistance(20);
            sound.setVolume(volume);
            sound.setPlaybackRate(playbackRate);
            if (!sound.isPlaying) {
                sound.play();
            }
        });
    }

    public remove(physicsWorld: World, scene: Scene) {
        scene.remove(this.sphereMesh)
        physicsWorld.removeRigidBody(this.sphereBody);
    }

    public update() {
        // Update point position in renderer
        const position = this.sphereBody!.translation();
        this.sphereMesh.position.set(position.x, position.y, 0);

        // Check if point needs updating based on state
        if (this.needsUpdate) {
            // Update point if it has collided;
            if (this.state == 'collided') {
                // Reset age clock
                // this should have a counter for number of reflections to keep particles from reflecting forever
                this.age /= 9;

                // Update color in renderer
                this.sphereMesh.material.uniforms.color.value = new Vector4(0.0, 0.0, 1.0, 1.0);

                // Update velocity to add jitter
                let linVel = this.sphereBody.linvel();
                let newX = linVel.x + this.jitter * (Math.random() - .5)
                let newY = linVel.y + this.jitter * (Math.random() - .5)
                this.sphereBody.setLinvel({ x: newX, y: newY }, true);

                // this.playReflectedSound();
            }

            this.needsUpdate = false;
        }

        this.age += this.clock.getDelta()

        const brightness = (1 - this.age / this.lifespan) * 100;
        const hue = 270;
        const color = new Color(`hsl(${hue}, 100%, ${brightness}%)`);
        let colorRGB = new Color();
        color.getRGB(colorRGB);

        if (this.state == 'collided') {
            this.sphereMesh.material.uniforms.color.value = new Vector4(colorRGB.r, colorRGB.g, colorRGB.b, 1.0);
        } else {
            this.sphereMesh.material.uniforms.color.value = new Vector4(brightness / 100, brightness / 100, brightness / 100, 1.0);
        }
    }
}