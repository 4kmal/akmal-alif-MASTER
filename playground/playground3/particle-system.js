/**
 * 3D Particle Flow System
 * Converting React Three Fiber scene to vanilla Three.js
 * Features: TorusKnot geometry, custom shaders, GPU computing, post-processing
 */

class ParticleFlowSystem {
    constructor() {
        this.size = 512; // Texture size for particle simulation
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        
        // FBOs for GPU computing
        this.fbo1 = null;
        this.fbo2 = null;
        
        // Materials
        this.simulationMaterial = null;
        this.renderMaterial = null;
        
        // Geometry
        this.particleSystem = null;
        this.originalPositionTexture = null;
        
        // Camera controls (simple orbit)
        this.controls = {
            mouseX: 0,
            mouseY: 0,
            targetX: 0,
            targetY: 0,
            distance: 5
        };
        
        this.init();
    }
    
    init() {
        this.setupRenderer();
        this.setupCamera();
        this.setupScene();
        this.setupMaterials();
        this.setupParticles();
        this.setupControls();
        this.animate();
        
        // Hide loading
        setTimeout(() => {
            const loading = document.getElementById('loading');
            if (loading) loading.style.display = 'none';
        }, 1000);
    }
    
    setupRenderer() {
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 1.0);
        
        // Enable advanced features
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        
        document.getElementById('container').appendChild(this.renderer.domElement);
        
        // Enable float textures
        if (!this.renderer.capabilities.isWebGL2 && !this.renderer.extensions.get('OES_texture_float')) {
            console.warn('Float textures not supported');
        }
    }
    
    setupCamera() {
        this.camera = new THREE.PerspectiveCamera(
            75, 
            window.innerWidth / window.innerHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(0, 0, 5);
    }
    
    setupScene() {
        this.scene = new THREE.Scene();
    }
    
    setupMaterials() {
        // Custom shader for particle simulation (GPU computing)
        this.simulationMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform sampler2D uCurrentPosition;
                uniform sampler2D uOriginalPosition;
                uniform float uTime;
                uniform float uCurl;
                uniform float uSpeed;

                vec3 snoise(vec3 uv) {
                    uv.x += uTime * 0.01;
                    float s = sin(uv.z * 2.1) * 0.2 + cos(uv.y * 3.2) * 0.3 + sin(uv.x * 2.2) * 0.2;
                    float c = cos(uv.z * 2.1) * 0.2 + sin(uv.y * 3.2) * 0.3 + cos(uv.x * 2.2) * 0.2;
                    float s2 = sin(uv.y * 1.1) * 0.2 + cos(uv.x * 2.2) * 0.3 + sin(uv.z * 1.2) * 0.2;
                    float c2 = cos(uv.y * 1.1) * 0.2 + sin(uv.x * 2.2) * 0.3 + cos(uv.z * 1.2) * 0.2;
                    return vec3(s, c, s2 * c2) * uCurl;
                }

                void main() {
                    vec3 currentPos = texture2D(uCurrentPosition, vUv).xyz;
                    vec3 originalPos = texture2D(uOriginalPosition, vUv).xyz;
                    vec3 noise = snoise(currentPos * 0.1);
                    currentPos += noise * uSpeed;
                    gl_FragColor = vec4(currentPos, 1.0);
                }
            `,
            uniforms: {
                uCurrentPosition: { value: null },
                uOriginalPosition: { value: null },
                uTime: { value: 0 },
                uCurl: { value: 1.5 },
                uSpeed: { value: 0.01 },
            },
        });
        
        // Custom shader for rendering particles
        this.renderMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                uniform sampler2D uPosition;
                uniform float uTime;
                varying vec3 vColor;

                void main() {
                    vec3 pos = texture2D(uPosition, position.xy).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = 1.5;
                    
                    // Create colorful effect based on position
                    vColor = normalize(pos) * 0.5 + 0.5;
                    
                    // Add some time-based color variation
                    vColor.r += sin(uTime * 2.0 + pos.x) * 0.2;
                    vColor.g += cos(uTime * 1.5 + pos.y) * 0.2;
                    vColor.b += sin(uTime * 3.0 + pos.z) * 0.2;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    // Create a circular particle shape with glow
                    vec2 center = gl_PointCoord - vec2(0.5, 0.5);
                    float dist = length(center);
                    if (dist > 0.5) discard;
                    
                    // Create bloom-like glow effect
                    float core = 1.0 - smoothstep(0.0, 0.1, dist);
                    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
                    
                    // Intensify the color for bloom effect
                    vec3 finalColor = vColor * (core * 2.0 + glow * 0.5);
                    float alpha = glow;
                    
                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            uniforms: {
                uPosition: { value: null },
                uTime: { value: 0 },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
        });
    }
    
    setupParticles() {
        // Create FBOs for GPU computing
        const renderTarget = new THREE.WebGLRenderTarget(this.size, this.size, {
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
        });
        
        this.fbo1 = renderTarget;
        this.fbo2 = this.fbo1.clone();
        
        // Initialize particle positions using TorusKnot geometry
        const particles = new Float32Array(this.size * this.size * 4); // RGBA format
        const torusKnot = new THREE.TorusKnotGeometry(1.2, 0.3, 400, 32);
        const positions = torusKnot.attributes.position.array;
        
        for (let i = 0; i < this.size * this.size; i++) {
            const i4 = i * 4;
            const p_i = (i * 3) % positions.length;
            particles[i4 + 0] = positions[p_i + 0];
            particles[i4 + 1] = positions[p_i + 1];
            particles[i4 + 2] = positions[p_i + 2];
            particles[i4 + 3] = 1.0; // Alpha
        }
        
        // Create original position texture
        this.originalPositionTexture = new THREE.DataTexture(
            particles,
            this.size,
            this.size,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        this.originalPositionTexture.needsUpdate = true;
        
        // Initialize FBO1 with the initial positions
        const initScene = new THREE.Scene();
        const initCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const initMaterial = new THREE.MeshBasicMaterial({ 
            map: this.originalPositionTexture 
        });
        const initMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), initMaterial);
        initScene.add(initMesh);
        
        this.renderer.setRenderTarget(this.fbo1);
        this.renderer.render(initScene, initCamera);
        this.renderer.setRenderTarget(null);
        
        // Create particle positions for rendering (UV coordinates)
        const particlePositions = new Float32Array(this.size * this.size * 3);
        for (let i = 0; i < this.size * this.size; i++) {
            const i3 = i * 3;
            particlePositions[i3 + 0] = (i % this.size) / this.size;
            particlePositions[i3 + 1] = Math.floor(i / this.size) / this.size;
            particlePositions[i3 + 2] = 0;
        }
        
        // Create particle system
        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
        
        this.particleSystem = new THREE.Points(particleGeometry, this.renderMaterial);
        this.scene.add(this.particleSystem);
    }
    
    setupControls() {
        // Simple mouse controls
        const canvas = this.renderer.domElement;
        
        canvas.addEventListener('mousemove', (event) => {
            this.controls.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
            this.controls.mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
        });
        
        canvas.addEventListener('wheel', (event) => {
            this.controls.distance += event.deltaY * 0.001;
            this.controls.distance = Math.max(2, Math.min(10, this.controls.distance));
        });
        
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }
    
    updateSimulation() {
        const simulationScene = new THREE.Scene();
        const simulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        // Update simulation uniforms
        this.simulationMaterial.uniforms.uCurrentPosition.value = this.fbo1.texture;
        this.simulationMaterial.uniforms.uOriginalPosition.value = this.originalPositionTexture;
        this.simulationMaterial.uniforms.uTime.value = this.clock.elapsedTime;
        
        const simulationMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2), 
            this.simulationMaterial
        );
        simulationScene.add(simulationMesh);
        
        // Render simulation to FBO2
        this.renderer.setRenderTarget(this.fbo2);
        this.renderer.render(simulationScene, simulationCamera);
        this.renderer.setRenderTarget(null);
        
        // Swap FBOs
        const temp = this.fbo1;
        this.fbo1 = this.fbo2;
        this.fbo2 = temp;
        
        // Update render material
        this.renderMaterial.uniforms.uPosition.value = this.fbo1.texture;
        this.renderMaterial.uniforms.uTime.value = this.clock.elapsedTime;
    }
    
    updateCamera() {
        // Smooth camera controls
        this.controls.targetX += (this.controls.mouseX - this.controls.targetX) * 0.05;
        this.controls.targetY += (this.controls.mouseY - this.controls.targetY) * 0.05;
        
        const phi = this.controls.targetY * Math.PI * 0.5;
        const theta = this.controls.targetX * Math.PI * 2;
        
        this.camera.position.x = Math.sin(theta) * Math.cos(phi) * this.controls.distance;
        this.camera.position.y = Math.sin(phi) * this.controls.distance;
        this.camera.position.z = Math.cos(theta) * Math.cos(phi) * this.controls.distance;
        
        this.camera.lookAt(0, 0, 0);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Update simulation
        this.updateSimulation();
        
        // Update camera
        this.updateCamera();
        
        // Auto-rotate the particle system
        if (this.particleSystem) {
            this.particleSystem.rotation.y += 0.001;
            this.particleSystem.rotation.x += 0.0005;
        }
        
        // Render main scene
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Particle Flow System...');
    new ParticleFlowSystem();
});