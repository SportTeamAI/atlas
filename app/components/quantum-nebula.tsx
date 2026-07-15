"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// Quantum Nebula — 21st.dev @dhileepkumargm
// Sistema de partículas Three.js: 50.000 partículas con simulación de
// curl noise, repulsión al mouse y post-procesado bloom.
const CONFIG = {
  particles: {
    count: 50000,
    size: 0.02,
    boxSize: 5,
  },
  colors: {
    baseHue: 200,
    hueVariance: 20,
  },
  simulation: {
    noiseSpeed: 0.1,
    noiseScale: 1.2,
    mouseRepulsion: 0.005,
    friction: 0.95,
  },
  bloom: {
    strength: 0.6,
    radius: 0.4,
    threshold: 0.1,
  },
  camera: {
    initialDistance: 5,
    parallaxIntensity: 0.005,
  },
};

export default function GenerativeArtSceneV3() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef(new THREE.Vector2(0, 0));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.z = CONFIG.camera.initialDistance;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      CONFIG.bloom.strength,
      CONFIG.bloom.radius,
      CONFIG.bloom.threshold
    );
    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    const count = CONFIG.particles.count;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3).fill(0);
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * CONFIG.particles.boxSize;
      positions[i3 + 1] = (Math.random() - 0.5) * CONFIG.particles.boxSize;
      positions[i3 + 2] = (Math.random() - 0.5) * CONFIG.particles.boxSize;

      const hue =
        (CONFIG.colors.baseHue +
          (Math.random() - 0.5) * CONFIG.colors.hueVariance) /
        360;
      color.setHSL(hue, 1, 0.6);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        u_pointSize: {
          value: CONFIG.particles.size * renderer.getPixelRatio(),
        },
      },
      vertexShader: `
                attribute vec3 color;
                varying vec3 vColor;
                uniform float u_pointSize;

                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = u_pointSize * (10.0 / -mvPosition.z); // Make particles appear smaller further away
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
      fragmentShader: `
                varying vec3 vColor;
                void main() {
                    // Create a soft, circular shape for each particle
                    float strength = distance(gl_PointCoord, vec2(0.5));
                    strength = 1.0 - step(0.5, strength);
                    if (strength < 0.01) discard; // Discard transparent fragments for performance

                    gl_FragColor = vec4(vColor, strength);
                }
            `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    const clock = new THREE.Clock();
    let animationFrame: number;

    const curlNoise = (pos: THREE.Vector3, time: number, scale: number) =>
      new THREE.Vector3(
        Math.sin(pos.y * scale + time),
        Math.cos(pos.z * scale + time),
        Math.sin(pos.x * scale + time)
      ).normalize();

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const posArray = particles.geometry.attributes.position
        .array as Float32Array;

      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const pos = new THREE.Vector3(
          posArray[i3],
          posArray[i3 + 1],
          posArray[i3 + 2]
        );
        const curl = curlNoise(
          pos,
          elapsed * CONFIG.simulation.noiseSpeed,
          CONFIG.simulation.noiseScale
        );

        const repulsion = new THREE.Vector3();
        const mouseWorld = new THREE.Vector3(
          mouseRef.current.x * (CONFIG.particles.boxSize / 2),
          mouseRef.current.y * (CONFIG.particles.boxSize / 2),
          0
        );
        const dist = pos.distanceTo(mouseWorld);
        if (dist < 2) {
          repulsion
            .subVectors(pos, mouseWorld)
            .normalize()
            .multiplyScalar(1 / (dist + 0.1));
        }

        velocities[i3] +=
          curl.x * 0.001 + repulsion.x * CONFIG.simulation.mouseRepulsion;
        velocities[i3 + 1] +=
          curl.y * 0.001 + repulsion.y * CONFIG.simulation.mouseRepulsion;
        velocities[i3 + 2] +=
          curl.z * 0.001 + repulsion.z * CONFIG.simulation.mouseRepulsion;

        velocities[i3] *= CONFIG.simulation.friction;
        velocities[i3 + 1] *= CONFIG.simulation.friction;
        velocities[i3 + 2] *= CONFIG.simulation.friction;

        posArray[i3] += velocities[i3];
        posArray[i3 + 1] += velocities[i3 + 1];
        posArray[i3 + 2] += velocities[i3 + 2];

        if (Math.abs(posArray[i3]) > CONFIG.particles.boxSize / 2)
          posArray[i3] *= -1;
        if (Math.abs(posArray[i3 + 1]) > CONFIG.particles.boxSize / 2)
          posArray[i3 + 1] *= -1;
        if (Math.abs(posArray[i3 + 2]) > CONFIG.particles.boxSize / 2)
          posArray[i3 + 2] *= -1;
      }

      particles.geometry.attributes.position.needsUpdate = true;

      camera.position.x +=
        (mouseRef.current.x * CONFIG.camera.parallaxIntensity -
          camera.position.x) *
        0.02;
      camera.position.y +=
        (-mouseRef.current.y * CONFIG.camera.parallaxIntensity -
          camera.position.y) *
        0.02;
      camera.lookAt(scene.position);

      composer.render();
      animationFrame = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };

    const handleMouseMove = (event: MouseEvent) => {
      mouseRef.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full z-0" />;
}
