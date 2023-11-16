import {
    Scene,
    Clock,
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

import chirp from '../sounds/chirp-placeholder.wav'
import chirpReverb from '../sounds/chirp-placeholder-reverb.wav'

export class Wavefront {
    position: Vector3;
    numPoints: number;
    pointSize: number;
    pointVelocity: number;
    velocityJitter: number;
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
        numPoints: number = 64,
        pointSize: number = .2,
        pointVelocity: number = 10,
        velocityJitter: number = 1.0,
        angleJitter: number = 1.0,
        pointSpawnDistance: number = 0,
    ) {
        this.position = position;
        this.numPoints = numPoints;
        this.pointSize = pointSize;
        this.pointVelocity = pointVelocity;
        this.velocityJitter = velocityJitter;
        this.angleJitter = angleJitter;
        this.pointSpawnDistance = pointSpawnDistance;
        this.lifespan = lifespan;

        const angleOffset = angleJitter * Math.random()

        this.playbackRate = 1 + (Math.random() * .5);
        this.initialSound = undefined;

        this.age = 0

        // Create points in wavefront in a circular arrangement
        for (let i = 0; i < this.numPoints; i++) {

            // Calculate initial position and velocity of points
            const angle = (i / this.numPoints) * Math.PI * 2 + angleOffset;

            const x = this.position.x + this.pointSpawnDistance * Math.sin(angle);
            const y = this.position.y + this.pointSpawnDistance * Math.cos(angle);

            const xVel = this.pointVelocity * Math.sin(angle)
            const yVel = this.pointVelocity * Math.cos(angle)

            const jitter = .5;

            const lifespan = this.lifespan;

            const soundID = ''

            // Add point to point array
            const point = new WavefrontPoint(x, y, xVel, yVel, pointSize, jitter, lifespan, soundID);
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

        // Play initial sound when wavefront is spawned
        this.playInitialSound();

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
    }

    private playInitialSound() {
        // Load and play initial chirp sound
        const audioLoader = new AudioLoader();
        let sound = this.initialSound;
        const playbackRate = this.playbackRate

        audioLoader.load(chirp, function (buffer) {
            sound!.setBuffer(buffer);
            sound!.setRefDistance(20);
            sound!.setPlaybackRate(playbackRate);
            sound!.play();
        });
    }

    public update() {
        this.age = this.clock.getElapsedTime();

        // Update rendered wavefront points and age
        this.points.forEach((point) => {
            point.update();
            point.age = this.age
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
    public soundID;
    public reflectedSound!: PositionalAudio;

    constructor(x: number, y: number, xVel: number, yVel: number, pointSize: number, jitter: number, lifespan: number, soundID: string) {
        this.x = x;
        this.y = y;
        this.xVel = xVel;
        this.yVel = yVel;
        this.pointSize = pointSize;
        this.jitter = jitter;
        this.lifespan = lifespan
        this.soundID = soundID;
        this.age = 0;
    }

    public attach(rapier: Rapier, physicsWorld: World, scene: Scene, listener: AudioListener) {
        // Create physics simulation point
        const rbDesc = rapier.RigidBodyDesc.dynamic()
            .setTranslation(this.x, this.y)
            .setLinvel(this.xVel, this.yVel)
            .setCcdEnabled(true);
        this.sphereBody = physicsWorld!.createRigidBody(rbDesc);

        // Create collider for point
        const clDesc = rapier.ColliderDesc.ball(this.pointSize)
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

    public update() {
        // Update point position in renderer
        const position = this.sphereBody!.translation();
        this.sphereMesh.position.set(position.x, position.y, 0);

        // Update point scale in renderer
        const scaleDecayCoeff = .01;
        const scale = this.sphereMesh.scale
        this.sphereMesh.scale.set(scale.x + scaleDecayCoeff, scale.y + scaleDecayCoeff, scale.z + scaleDecayCoeff);

        // Update point color in renderer
        const colorDecayCoeff = 1 - (this.age / this.lifespan) ** 2;
        const flicker = Math.sin(this.age * .2 + 3 * Math.random()) * .01;
        const color = this.sphereMesh.material.uniforms.color.value;
        this.sphereMesh.material.uniforms.color.value = new Vector4(
            color.x * colorDecayCoeff + flicker,
            color.y * colorDecayCoeff + flicker,
            color.z * colorDecayCoeff + flicker,
            color.w
        );

        // Check if point needs updating based on state
        if (this.needsUpdate) {
            // Update point if it has collided;
            if (this.state = 'collided') {
                // Update color in renderer
                // TODO: convert to HSL to easily change color instead of setting new brightness
                this.sphereMesh.material.uniforms.color.value = new Vector4(color.x - .2, color.y - .2, color.z + .3, color.w);

                // Update velocity to add jitter
                let linVel = this.sphereBody.linvel();
                let newX = linVel.x + this.jitter * (Math.random() - .5)
                let newY = linVel.y + this.jitter * (Math.random() - .5)
                this.sphereBody.setLinvel({ x: newX, y: newY }, true);

                // Load and play reflected sound upon collision
                this.reflectedSound.stop();
                const audioLoader = new AudioLoader();
                const volume = 1 - Math.sqrt(this.age / this.lifespan);
                let sound = this.reflectedSound;

                audioLoader.load(chirpReverb, function (buffer) {
                    sound.setBuffer(buffer);
                    sound.setRefDistance(20);
                    sound.setPlaybackRate(1 + (Math.random() * .2));
                    sound.setVolume(volume);
                    sound.play();
                });
            }
            // Handle other states here

            this.needsUpdate = false;
        }
    }
}