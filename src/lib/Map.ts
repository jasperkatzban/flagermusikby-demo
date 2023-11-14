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
    pointSize: number = .2;
    points: Array<SurfacePoint> = []

    constructor(
        rapier: any,
        physicsWorld: any,
        scene: Scene,
    ) {
        this.rapier = rapier;
        this.physicsWorld = physicsWorld;
        this.scene = scene;

        // Create a simple line of points representing a wall
        for (let i = 0; i < 100; i++) {
            const x = (i - 50) * .4 + Math.random() * .2;
            const y = 10 + Math.random() * .2;

            // Create physics simulation point
            const rbDesc = rapier.RigidBodyDesc.kinematicPositionBased()
                .setTranslation(x, y)
                .setCcdEnabled(true);
            const surfaceBody = physicsWorld!.createRigidBody(rbDesc);

            // Create collider for point
            const clDesc = rapier.ColliderDesc.ball(this.pointSize)
                .setFriction(0.0)
                .setFrictionCombineRule(rapier.CoefficientCombineRule.Max)
                .setRestitution(1.0)
                .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max)
                .setCollisionGroups(0x00020001)
                .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
            physicsWorld!.createCollider(clDesc, surfaceBody);

            // Capture unique identifier for point body
            const handle = surfaceBody.handle;

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
            const surfaceMesh = new Mesh(geometry, pointMaterial);
            surfaceMesh.position.set(x, y, 0)
            this.scene.add(surfaceMesh)

            // Flag for if point has reflected
            // TODO: this will likely become a more nuanced state to handle multiple reflections off of multiple surfaces
            const needsUpdate = false;

            // Add point to global point array
            const point = new SurfacePoint(handle, x, y, surfaceBody, surfaceMesh, needsUpdate)
            this.points.push(point)
        }
    }

    public update() {
        // Update rendered wavefront positions
        this.points.forEach((point) => {
            // Update point color in renderer
            const colorDecayCoeff = 1.0 / 1000;
            const color = point.surfaceMesh.material.uniforms.color.value;
            point.surfaceMesh.material.uniforms.color.value = new Vector4(
                Math.max(color.x - colorDecayCoeff, 0),
                Math.max(color.y - colorDecayCoeff, 0),
                Math.max(color.z - colorDecayCoeff, 0),
                color.w
            );

            // Update point if it has collided;
            if (point.needsUpdate) {
                // Update color in renderer
                point.surfaceMesh.material.uniforms.color.value = new Vector4(1.0, 1.0, 1.0, color.w);

                point.needsUpdate = false;
            }
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
    public surfaceBody: RigidBody;
    public surfaceMesh: Mesh;
    public needsUpdate: boolean;

    constructor(handle: number, x: number, y: number, surfaceBody: RigidBody, surfaceMesh: Mesh, needsUpdate: boolean) {
        this.handle = handle;
        this.x = x;
        this.y = y;
        this.surfaceBody = surfaceBody;
        this.surfaceMesh = surfaceMesh;
        this.needsUpdate = needsUpdate;
    }
}