// Shader terénu s vlastním osvětlením:
//  • Slunce × okno osvětlení (stíny kopců a kráterů z planet/sunwindow.js),
//  • stíny objektů ze stínové mapy kolem hráče,
//  • odraz od Země, okolní světlo a čelovka,
//  • prach z textury atlasu ztmaví povrch,
//  • písková textura (zrno + čeřiny) promítnutá ze tří os; zametený povrch je hladší.
// Osvětlení odpovídá MeshLambertMaterial (bez fyzikálně korektních světel), aby terén ladil s objekty.

import { PLANET } from '../config.js';
import { sandTexture } from './sandTexture.js';

const THREE = window.THREE;

const vertexShader = /* glsl */`
  attribute vec2 sunWin;          // [východ, západ] vůči místnímu poledni (rad)
  uniform float sunAngle;         // úhel Slunce na jeho dráze (rad, 0–2π)
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vSunVis;

  void main() {
    vUv = uv;
    vColor = color;
    vNormalW = normal;
    vPosW = position;              // kusy terénu jsou ve světových souřadnicích

    // kde je Slunce vůči místnímu poledni tohoto bodu
    float noon = atan(position.x, position.z);
    float rel = mod(sunAngle - noon + 3.14159265, 6.28318531) - 3.14159265;
    const float soft = 0.012;      // měkký okraj stínu (~0,7°)
    vSunVis = smoothstep(sunWin.x - soft, sunWin.x + soft, rel)
            * (1.0 - smoothstep(sunWin.y - soft, sunWin.y + soft, rel));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  #include <packing>
  uniform sampler2D dustMap;
  uniform sampler2D sandMap;
  uniform float sandScale;
  uniform float sandStrength;
  uniform float dirtScale;
  uniform vec3 dirtTint;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 ambient;
  uniform vec3 earthDir;
  uniform vec3 earthColor;
  uniform vec3 lampPos;
  uniform vec3 lampColor;
  uniform float lampRange;
  uniform sampler2D shadowMap;
  uniform mat4 shadowMatrix;
  uniform float useShadowMap;
  uniform float shadowTexel;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vSunVis;

  // stíny objektů (astronaut, vozidla, budovy) ze stínové mapy slunce
  float objectShadow() {
    if (useShadowMap < 0.5) return 1.0;
    vec4 sc = shadowMatrix * vec4(vPosW, 1.0);
    vec3 c = sc.xyz / sc.w;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float z = c.z - 0.0015;
    float o = shadowTexel * 0.75;
    float lit = step(z, unpackRGBAToDepth(texture2D(shadowMap, c.xy + vec2(-o, -o))))
              + step(z, unpackRGBAToDepth(texture2D(shadowMap, c.xy + vec2( o, -o))))
              + step(z, unpackRGBAToDepth(texture2D(shadowMap, c.xy + vec2(-o,  o))))
              + step(z, unpackRGBAToDepth(texture2D(shadowMap, c.xy + vec2( o,  o))));
    return lit * 0.25;
  }

  void main() {
    vec3 n = normalize(vNormalW);
    float dirt = sqrt(clamp(texture2D(dustMap, vUv).r * dirtScale, 0.0, 1.0));
    vec3 albedo = vColor * mix(vec3(1.0), dirtTint, dirt);

    // písek: vzorek ze tří os podle normály (bez natahování na svazích)
    vec3 bw = pow(abs(n), vec3(4.0));
    bw /= (bw.x + bw.y + bw.z);
    vec3 sp = vPosW * sandScale;
    vec4 sand = texture2D(sandMap, sp.yz) * bw.x + texture2D(sandMap, sp.xz) * bw.y + texture2D(sandMap, sp.xy) * bw.z;
    float grain = sand.r - 0.5, ripple = sand.g - 0.5;
    albedo *= 1.0 + sandStrength * (grain * 0.2 + ripple * 0.26 * (0.3 + 0.7 * dirt));

    float sunNL = max(dot(n, sunDir), 0.0);
    float sun = sunNL > 0.0 && vSunVis > 0.0 ? sunNL * vSunVis * objectShadow() : 0.0;
    vec3 light = ambient + earthColor * max(dot(n, earthDir), 0.0) + sunColor * sun;

    vec3 toLamp = lampPos - vPosW;
    float dl = length(toLamp);
    float att = pow(clamp(1.0 - dl / lampRange, 0.0, 1.0), 2.0);
    light += lampColor * att * max(dot(n, toLamp / max(dl, 0.001)), 0.0);

    gl_FragColor = vec4(albedo * light, 1.0);
  }
`;

export function createTerrainMaterial(dustTexture, dirtScale, renderer = null) {
  const uniforms = {
    dustMap: { value: dustTexture },
    sandMap: { value: sandTexture(renderer) },
    sandScale: { value: 1 / 8 },                 // dlaždice písku 8 m
    sandStrength: { value: 1 },
    dirtScale: { value: dirtScale },
    dirtTint: { value: new THREE.Vector3(...PLANET.dirt) },   // barva prachu proti čistému povrchu
    sunAngle: { value: 0 },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(PLANET.sun).multiplyScalar(PLANET.sunPower) },
    ambient: { value: new THREE.Color(PLANET.ambient) },
    earthDir: { value: new THREE.Vector3(0, 1, 0) },
    earthColor: { value: new THREE.Color(0x7f9cd0) },
    lampPos: { value: new THREE.Vector3() },
    lampColor: { value: new THREE.Color(0) },
    lampRange: { value: 20 },
    shadowMap: { value: null },
    shadowMatrix: { value: new THREE.Matrix4() },
    useShadowMap: { value: 0 },
    shadowTexel: { value: 1 / 1024 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, vertexColors: true });
  return { material, uniforms };
}
