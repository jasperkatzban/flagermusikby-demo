import {
    Scene,
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
    rapier!: Rapier;
    physicsWorld?: World;
    scene: Scene;
    listener: AudioListener;
    position: Vector3;
    numPoints: number;
    pointSize: number;
    pointVelocity: number;
    velocityJitter: number;
    angleJitter: number;
    pointSpawnDistance: number;
    age: number = 0;

    points: Array<WavefrontPoint> = []
    initialSound: PositionalAudio;
    playbackRate: number;

    constructor(
        rapier: any,
        physicsWorld: any,
        scene: Scene,
        listener: AudioListener,
        position: Vector3,
        numPoints: number = 64,
        pointSize: number = .1,
        pointVelocity: number = 10,
        velocityJitter: number = 1.0,
        angleJitter: number = 1.0,
        pointSpawnDistance: number = 0,
    ) {
        this.rapier = rapier;
        this.physicsWorld = physicsWorld;
        this.scene = scene;
        this.listener = listener;
        this.position = position;
        this.numPoints = numPoints;
        this.pointSize = pointSize;
        this.pointVelocity = pointVelocity;
        this.velocityJitter = velocityJitter;
        this.angleJitter = angleJitter;
        this.pointSpawnDistance = pointSpawnDistance;

        const angleOffset = angleJitter * Math.random()

        this.playbackRate = 1 + (Math.random() * .5);

        // Create points in wavefront in a circular arrangement
        for (let i = 0; i < this.numPoints; i++) {
            // Calculate initial position and velocity of points
            const angle = (i / this.numPoints) * Math.PI * 2 + angleOffset;

            const x = this.position.x + this.pointSpawnDistance * Math.sin(angle);
            const y = this.position.y + this.pointSpawnDistance * Math.cos(angle);

            const xVel = this.pointVelocity * Math.sin(angle)
            const yVel = this.pointVelocity * Math.cos(angle)

            // Create physics simulation point
            const rbDesc = rapier.RigidBodyDesc.dynamic()
                .setTranslation(x, y)
                .setLinvel(xVel, yVel)
                .setCcdEnabled(true);
            const sphereBody = physicsWorld!.createRigidBody(rbDesc);

            // Create collider for point
            const clDesc = rapier.ColliderDesc.ball(this.pointSize)
                .setFriction(0.0)
                .setFrictionCombineRule(rapier.CoefficientCombineRule.Max)
                .setRestitution(1.0)
                .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max)
                .setCollisionGroups(0x00010002)
                .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
            physicsWorld!.createCollider(clDesc, sphereBody);

            // Capture unique identifier for point body
            const handle = sphereBody.handle;

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
            const sphereMesh = new Mesh(geometry, pointMaterial);
            this.scene.add(sphereMesh)

            // Flag for if point has reflected
            // TODO: this will likely become a more nuanced state to handle multiple reflections off of multiple surfaces
            const needsUpdate = false;

            // Create the PositionalAudio object (passing in the listener)
            const reflectedSound = new PositionalAudio(this.listener);

            // Load a sound and set it as the PositionalAudio object's buffer
            const audioLoader = new AudioLoader();

            // Load and play reflected chirp sound
            const playbackRate = this.playbackRate
            audioLoader.load(chirpReverb, function (buffer) {
                reflectedSound.setBuffer(buffer);
                reflectedSound.setRefDistance(20);
                reflectedSound.setPlaybackRate(playbackRate - .2);
            });

            // Add point to global point array
            const point = new WavefrontPoint(handle, x, y, sphereBody, sphereMesh, reflectedSound, needsUpdate)
            this.points.push(point)
        }

        // Create the PositionalAudio object (passing in the listener)
        this.initialSound = new PositionalAudio(this.listener);

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
        const centerMesh = new Mesh(geometry, centerMaterial);
        centerMesh.position.set(position.x, position.y, position.z);
        this.scene.add(centerMesh);
        centerMesh.add(this.initialSound);

        // Play initial sound when wavefront is spawned
        this.playInitialSound();
    }

    private playInitialSound() {
        // Load a sound and set it as the PositionalAudio object's buffer
        const audioLoader = new AudioLoader();

        // Load and play initial chirp sound
        let sound = this.initialSound;
        const playbackRate = this.playbackRate
        audioLoader.load(chirp, function (buffer) {
            sound.setBuffer(buffer);
            sound.setRefDistance(20);
            sound.setPlaybackRate(playbackRate);
            sound.play();
        });
    }

    public update() {
        // Update rendered wavefront positions
        this.points.forEach((point) => {
            // Update point position in renderer
            const position = point.sphereBody!.translation();
            point.sphereMesh.position.set(position.x, position.y, 0);

            // Update point scale in renderer
            const scaleDecayCoeff = .01;
            const scale = point.sphereMesh.scale
            point.sphereMesh.scale.set(scale.x + scaleDecayCoeff, scale.y + scaleDecayCoeff, scale.z + scaleDecayCoeff);

            // Update point color in renderer
            const colorDecayCoeff = 1.0 / 400;
            const color = point.sphereMesh.material.uniforms.color.value;
            point.sphereMesh.material.uniforms.color.value = new Vector4(
                color.x - colorDecayCoeff,
                color.y - colorDecayCoeff,
                color.z - colorDecayCoeff,
                color.w
            );

            // Update point if it has collided;
            if (point.needsUpdate) {
                // Update color in renderer
                point.sphereMesh.material.uniforms.color.value = new Vector4(color.x, color.y, color.z + .5, color.w);

                // Update velocity
                let linVel = point.sphereBody.linvel();
                let newX = linVel.x + this.velocityJitter * (Math.random() - .5)
                let newY = linVel.y + this.velocityJitter * (Math.random() - .5)
                point.sphereBody.setLinvel(new this.rapier.Vector2(newX, newY), true);

                // Play reflected sound upon collision
                point.reflectedSound.play()

                point.needsUpdate = false;
            }
        })

        // TODO: increment age based on time, not frames
        this.age += 1;
    }

    // TODO: specify type of collision based on type of material contacted
    public checkCollisionEvents(handle1: number, handle2: number) {
        this.points.forEach((point) => {
            if (point.handle == handle1 || point.handle == handle2) {
                point.needsUpdate = true;
            }
        })
    }

    public remove() {
        // If point is passed lifecycle, remove it from world
        this.points.forEach((point) => {
            this.scene.remove(point.sphereMesh);
            this.physicsWorld.removeRigidBody(point.sphereBody);
        })
    }
}

class WavefrontPoint {
    public handle: number;
    public x: number;
    public y: number;
    public sphereBody: RigidBody;
    public sphereMesh: Mesh;
    public reflectedSound: PositionalAudio;
    public needsUpdate: boolean;

    constructor(handle: number, x: number, y: number, sphereBody: RigidBody, sphereMesh: Mesh, reflectedSound: PositionalAudio, needsUpdate: boolean) {
        this.handle = handle;
        this.x = x;
        this.y = y;
        this.sphereBody = sphereBody;
        this.sphereMesh = sphereMesh;
        this.reflectedSound = reflectedSound;
        this.needsUpdate = needsUpdate;
    }

    public playReflectedSound() {
        // Load a sound and set it as the PositionalAudio object's buffer
        const audioLoader = new AudioLoader();

        let sound = this.reflectedSound;
        // Load and play reflected chirp sound
        audioLoader.load(chirpReverb, function (buffer) {
            sound.setBuffer(buffer);
            sound.setRefDistance(20);
            sound.setPlaybackRate(1 + (Math.random() * .2));
            sound.play();
        });
    }
}