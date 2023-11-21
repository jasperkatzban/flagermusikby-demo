import {
    Scene,
    InstancedMesh,
    CircleGeometry,
    Object3D,
    MeshBasicMaterial,
    Color
} from "three";
import { parse } from 'svg-parser';

import mapSVG from '../map/map.svg?raw'

export class Map {
    rapier!: Rapier;
    physicsWorld?: World;
    scene: Scene;
    mapPoints: Array<MapPoint> = []
    renderedMesh: InstancedMesh;

    origin = { x: -120, y: 230 };
    pointsFillGap = 0.5;
    minPointDistance = 0.3;
    pointsJitter = 0.2;

    constructor(
        rapier: Rapier,
        physicsWorld: World,
        scene: Scene,
    ) {
        this.rapier = rapier;
        this.physicsWorld = physicsWorld;
        this.scene = scene;

        // parse svg of city map to JSON
        console.log("Parsing SVG to JSON...")
        const parsedSvg = parse(mapSVG);
        console.log("Done!")

        let segments: { x1: number, y1: number, x2: number, y2: number }[] = [];

        // extract coordinates from parsed JSON
        console.log("Extracting Line Segments...")
        parsedSvg.children.forEach(child => {
            if (child.hasOwnProperty('children')) {
                child.children.forEach(nested => {
                    nested.children.forEach(polygon => {
                        // TODO: use endpoints to interpolate points in between lines
                        let { x1, y1, x2, y2 } = polygon.properties;
                        if (x1 & y1 & x2 & y2) {
                            // Offset points by origin they spawn in view and correct for y inversion
                            x1 += this.origin.x;
                            y1 = -y1 + this.origin.y;
                            x2 += this.origin.x;
                            y2 = -y2 + this.origin.y;
                            segments.push({ x1, y1, x2, y2 });
                        }
                    })
                })
            }
        })
        console.log(`Done, created ${segments.length} segments!`);

        // Remove duplicate segments
        // TODO: temporary, should not need to filter duplicate points at runtime
        console.log("Removing duplicate segments...")
        segments = segments!.filter((value, index, self) =>
            index === self.findIndex((t) => (
                (t.x1 === value.x1 && t.y1 === value.y1 && t.x2 === value.x2 && t.y2 === value.y2) || (t.x1 === value.x2 && t.y1 === value.y2 && t.x2 === value.x1 && t.y2 === value.y1)
            ))
        )
        console.log(`Done, there are now ${segments.length} segments!`);

        let coordinates: { x: number, y: number }[] = [];

        console.log("Creating points along segments...")
        segments.forEach((segment) => {
            const { x1, y1, x2, y2 } = segment;
            const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

            if (length > 0) {
                let progress = 0;
                while (progress < length) {
                    const x = x1 + (x2 - x1) * (progress / length);
                    const y = y1 + (y2 - y1) * (progress / length);
                    coordinates.push({ x, y });
                    progress += this.pointsFillGap;
                }
            } else {
                coordinates.push({ x: x1, y: y1 });
            }
        })
        console.log(`Done, created ${coordinates.length} points!`)

        console.log("Merging coordinates by distance threshold...")
        coordinates = coordinates!.filter((value, index, self) =>
            index === self.findIndex((t) => (
                (Math.abs(t.x - value.x) < this.minPointDistance) && (Math.abs(t.y - value.y) < this.minPointDistance)
            ))
        )
        console.log(`Done, there are now ${coordinates.length} points!`);

        console.log("Adding jitter to points...")
        coordinates.forEach(coordinate => {
            coordinate.x += this.pointsJitter * (Math.random() - 0.5);
            coordinate.y += this.pointsJitter * (Math.random() - 0.5);
        })
        console.log("Done!")

        // TODO: set size and color based on object type
        const geometry = new CircleGeometry(.2, 5);
        const material = new MeshBasicMaterial({ color: 0xffffff });
        const count = coordinates.length;

        this.renderedMesh = new InstancedMesh(geometry, material, count);
        scene.add(this.renderedMesh);

        // create points
        const dummy = new Object3D();
        coordinates.forEach((coordinate, i) => {
            // create points for physics simulation
            const newPoint = new MapPoint('building', coordinate.x, coordinate.y);
            newPoint.attach(this.rapier, this.physicsWorld);
            this.mapPoints.push(newPoint);

            // set positions of rendered points in instanced mesh
            dummy.position.set(coordinate.x, coordinate.y, 0);
            dummy.rotation.z = Math.random() * Math.PI;
            dummy.updateMatrix();
            this.renderedMesh.setMatrixAt(i, dummy.matrix);
        })
    }

    public update() {
        this.mapPoints.forEach((mapPoint, i) => {
            this.updateRenderedMeshColor(i, mapPoint);
        })
    }

    // TODO: set color based on object type too
    public updateRenderedMeshColor(index: number, mapPoint: MapPoint) {
        let color = new Color(0x0f1a2e);

        switch (mapPoint.state) {
            case "collided":
                color.setHex(0x206b96)
                break;
        }

        this.renderedMesh.setColorAt(index, color);

        if (this.renderedMesh.instanceColor) {
            this.renderedMesh.instanceColor.needsUpdate = true;
        }
    }

    // TODO: specify type of collision based on type of material contacted
    public checkCollisionEvents(handle1: number, handle2: number) {
        this.mapPoints.forEach((point) => {
            if (point.handle == handle1 || point.handle == handle2) {
                point.setState('collided');
            }
        })
    }
}

class MapPoint {
    public type: string;
    public handle: number;
    public state: string = "hidden";
    public x: number;
    public y: number;
    public surfaceBody: RigidBody;
    private pointSize: number = .2;

    constructor(type: string, x: number, y: number) {
        this.type = type;
        this.x = x;
        this.y = y;
    }

    public attach(rapier: Rapier, physicsWorld: World) {
        // Create physics simulation point
        const rbDesc = rapier.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(this.x, this.y)
            .setCcdEnabled(true);
        this.surfaceBody = physicsWorld!.createRigidBody(rbDesc);

        // Create collider for point
        const clDesc = rapier.ColliderDesc.cuboid(this.pointSize, this.pointSize)
            .setFriction(0.0)
            .setFrictionCombineRule(rapier.CoefficientCombineRule.Max)
            .setRestitution(1.0)
            .setRestitutionCombineRule(rapier.CoefficientCombineRule.Max)
            .setCollisionGroups(0x00020001)
            .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
        physicsWorld!.createCollider(clDesc, this.surfaceBody);

        // Capture unique identifier for point body
        this.handle = this.surfaceBody.handle;
    }

    public setState(state: string) {
        this.state = state;
    }
}
