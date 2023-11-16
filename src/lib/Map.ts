import {
    Scene,
    Vector4,
    Mesh,
    SphereGeometry,
    ShaderMaterial,
} from "three";

import toonVertexShader from '../shaders/toon.vert?raw'
import toonFragmentShader from '../shaders/toon.frag?raw'

export class Map {
    rapier!: Rapier;
    physicsWorld?: World;
    scene: Scene;
    points: Array<SurfacePoint> = []

    constructor(
        rapier: Rapier,
        physicsWorld: World,
        scene: Scene,
    ) {
        this.rapier = rapier;
        this.physicsWorld = physicsWorld;
        this.scene = scene;

        // Create a simple line of points representing a wall
        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 400; j++) {
                const x = (i - 1) * 20 + Math.random() * .2;
                const y = (j - 200) * .4 + Math.random() * .2;

                // Flag for if point has reflected
                // TODO: this will likely become a more nuanced state to handle multiple reflections off of multiple surfaces

                // Add point to global point array
                const point = new SurfacePoint(x, y)
                point.attach(this.rapier, this.physicsWorld, this.scene)
                this.points.push(point)
            }
        }
    }

    public update() {
        this.points.forEach((point) => {
            point.update()
        })
    }

    // TODO: specify type of collision based on type of material contacted
    public checkCollisionEvents(handle1: number, handle2: number) {
        this.points.forEach((point) => {
            if (point.handle == handle1 || point.handle == handle2) {
                point.needsUpdate = true;
            }
        })
    }
}

class SurfacePoint {
    public handle: number;
    public x: number;
    public y: number;
    public pointSize: number;
    public surfaceBody: RigidBody;
    public surfaceMesh: Mesh;
    public needsUpdate: boolean = false;

    constructor(x: number, y: number, pointSize: number = .2) {
        this.x = x;
        this.y = y;
        this.pointSize = pointSize;
    }

    public attach(rapier: Rapier, physicsWorld: World, scene: Scene) {
        // Create physics simulation point
        const rbDesc = rapier.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(this.x, this.y)
            .setCcdEnabled(true);
        this.surfaceBody = physicsWorld!.createRigidBody(rbDesc);

        // Create collider for point
        const clDesc = rapier.ColliderDesc.ball(this.pointSize)
            .setFriction(0.0)
            .setFrictionCombineRule(rapier.CoefficientCombineRule.Max)
            .setRestitution(1.0)
            .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max)
            .setCollisionGroups(0x00020001)
            .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
        physicsWorld!.createCollider(clDesc, this.surfaceBody);

        // Capture unique identifier for point body
        this.handle = this.surfaceBody.handle;

        // Create rendered point
        const pointMaterial = new ShaderMaterial({
            uniforms: {
                color:
                    { value: new Vector4(0.0, 0.0, 0.0, 1.0) }
            },
            vertexShader: toonVertexShader,
            fragmentShader: toonFragmentShader,
        })

        const geometry = new SphereGeometry(this.pointSize, 0, 5);
        this.surfaceMesh = new Mesh(geometry, pointMaterial);
        this.surfaceMesh.position.set(this.x, this.y, 0)
        scene.add(this.surfaceMesh)
    }

    public update() {
        // Update point color in renderer
        const colorDecayCoeff = 1.0 / 1000;
        const color = this.surfaceMesh.material.uniforms.color.value;
        this.surfaceMesh.material.uniforms.color.value = new Vector4(
            Math.max(color.x - colorDecayCoeff, 0),
            Math.max(color.y - colorDecayCoeff, 0),
            Math.max(color.z - colorDecayCoeff, 0),
            color.w
        );

        // Update point if it has collided;
        if (this.needsUpdate) {
            // Update color in renderer
            this.surfaceMesh.material.uniforms.color.value = new Vector4(1.0, 1.0, 1.0, color.w);
            this.needsUpdate = false;
        }
    }
}