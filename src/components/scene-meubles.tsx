"use client";

import { useEffect, useRef } from "react";
// Import de types uniquement : il disparait a la compilation, Three.js reste
// charge a l'execution par l'import dynamique dans l'effet.
import type * as Trois from "three";

/**
 * Decor 3D de la page de connexion.
 *
 * Un mobilier simple — table, chaises, tabouret — construit en volumes arrondis,
 * pose sur un sol clair et eclaire comme un studio photo. Le groupe suit la
 * souris avec une inertie douce : la scene s'incline un peu, la camera glisse,
 * et le mobilier revient a sa place quand la souris s'arrete.
 *
 * Contraintes tenues ici :
 *  - Three.js n'est charge qu'a l'execution, jamais cote serveur ni dans le
 *    bundle initial de la page ;
 *  - `prefers-reduced-motion` rend une image fixe, sans animation ;
 *  - si WebGL n'est pas disponible, le conteneur reste vide et le degrade CSS
 *    de la page prend le relais ;
 *  - tout est libere au demontage (geometries, materiaux, renderer, ecouteurs).
 */
export function SceneMeubles() {
  const conteneur = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = conteneur.current;
    if (!element) return;

    let arret = false;
    let image = 0;
    let liberer: (() => void) | null = null;

    void (async () => {
      const [THREE, geometrie] = await Promise.all([
        import("three"),
        import("three/examples/jsm/geometries/RoundedBoxGeometry.js"),
      ]);
      if (arret) return;

      const RoundedBoxGeometry = geometrie.RoundedBoxGeometry;

      const renderer = (() => {
        try {
          return new THREE.WebGLRenderer({ antialias: true, alpha: true });
        } catch {
          return null;
        }
      })();
      if (!renderer) return;

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.display = "block";
      element.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
      camera.position.set(0, 2.15, 8.2);
      camera.lookAt(0, 0.5, 0);

      // --- Lumieres : studio clair, une ombre portee douce ------------------
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d9e2, 1.15));

      const soleil = new THREE.DirectionalLight(0xffffff, 2.3);
      soleil.position.set(3.6, 6.2, 4.6);
      soleil.castShadow = true;
      soleil.shadow.mapSize.set(1024, 1024);
      soleil.shadow.camera.near = 1;
      soleil.shadow.camera.far = 20;
      soleil.shadow.camera.left = -7;
      soleil.shadow.camera.right = 7;
      soleil.shadow.camera.top = 7;
      soleil.shadow.camera.bottom = -7;
      soleil.shadow.bias = -0.0006;
      soleil.shadow.radius = 4;
      scene.add(soleil);

      const appoint = new THREE.DirectionalLight(0xf3f1ff, 0.55);
      appoint.position.set(-4.5, 3, -3.5);
      scene.add(appoint);

      // --- Sol ---------------------------------------------------------------
      const sol = new THREE.Mesh(
        new THREE.CircleGeometry(10, 64),
        new THREE.MeshStandardMaterial({ color: 0xe6e6eb, roughness: 1 }),
      );
      sol.rotation.x = -Math.PI / 2;
      sol.receiveShadow = true;
      scene.add(sol);

      // --- Materiaux ---------------------------------------------------------
      const bois = new THREE.MeshStandardMaterial({
        color: 0xd9b992,
        roughness: 0.62,
        metalness: 0.04,
      });
      const plateau = new THREE.MeshStandardMaterial({
        color: 0xfaf7f2,
        roughness: 0.45,
        metalness: 0.02,
      });
      const metal = new THREE.MeshStandardMaterial({
        color: 0x2f3237,
        roughness: 0.38,
        metalness: 0.55,
      });
      const tissus = [
        new THREE.MeshStandardMaterial({ color: 0x9fdcd4, roughness: 0.92 }),
        new THREE.MeshStandardMaterial({ color: 0xcfc3f5, roughness: 0.92 }),
        new THREE.MeshStandardMaterial({ color: 0xf2dcb8, roughness: 0.92 }),
      ];

      const mobilier = new THREE.Group();
      mobilier.scale.setScalar(0.78);
      scene.add(mobilier);

      const poser = (
        geometrie3d: Trois.BufferGeometry,
        materiau: Trois.Material,
        x: number,
        y: number,
        z: number,
      ) => {
        const maille = new THREE.Mesh(geometrie3d, materiau);
        maille.position.set(x, y, z);
        maille.castShadow = true;
        maille.receiveShadow = true;
        return maille;
      };

      /** Chaise : assise, dossier incline, quatre pieds. */
      const chaise = (materiau: Trois.Material) => {
        const groupe = new THREE.Group();

        groupe.add(
          poser(new RoundedBoxGeometry(0.98, 0.13, 0.92, 4, 0.05), materiau, 0, 0.46, 0),
        );

        const dossier = poser(
          new RoundedBoxGeometry(0.98, 0.82, 0.11, 4, 0.05),
          materiau,
          0,
          0.9,
          -0.42,
        );
        dossier.rotation.x = -0.13;
        groupe.add(dossier);

        for (const dx of [-0.39, 0.39]) {
          for (const dz of [-0.36, 0.36]) {
            groupe.add(
              poser(new THREE.BoxGeometry(0.07, 0.46, 0.07), metal, dx, 0.23, dz),
            );
          }
        }
        return groupe;
      };

      /** Table : plateau arrondi et quatre pieds. */
      const table = (() => {
        const groupe = new THREE.Group();
        groupe.add(
          poser(new RoundedBoxGeometry(3.05, 0.12, 1.62, 5, 0.05), plateau, 0, 0.79, 0),
        );
        for (const dx of [-1.32, 1.32]) {
          for (const dz of [-0.64, 0.64]) {
            groupe.add(
              poser(new THREE.BoxGeometry(0.09, 0.79, 0.09), bois, dx, 0.395, dz),
            );
          }
        }
        return groupe;
      })();
      table.position.set(0, 0, -0.15);
      mobilier.add(table);

      const chaiseGauche = chaise(tissus[0]);
      chaiseGauche.position.set(-1.95, 0, 0.62);
      chaiseGauche.rotation.y = Math.PI * 0.44;
      mobilier.add(chaiseGauche);

      const chaiseDroite = chaise(tissus[1]);
      chaiseDroite.position.set(1.95, 0, 0.62);
      chaiseDroite.rotation.y = -Math.PI * 0.44;
      mobilier.add(chaiseDroite);

      // Tabouret, un peu en avant, pour casser la symetrie.
      const tabouret = new THREE.Group();
      tabouret.add(
        poser(new THREE.CylinderGeometry(0.34, 0.34, 0.11, 32), tissus[2], 0, 0.47, 0),
      );
      for (let i = 0; i < 3; i += 1) {
        const angle = (i / 3) * Math.PI * 2;
        const pied = poser(
          new THREE.CylinderGeometry(0.028, 0.028, 0.46, 12),
          metal,
          Math.cos(angle) * 0.22,
          0.23,
          Math.sin(angle) * 0.22,
        );
        pied.rotation.z = Math.cos(angle) * 0.09;
        pied.rotation.x = -Math.sin(angle) * 0.09;
        tabouret.add(pied);
      }
      tabouret.position.set(0.15, 0, 1.62);
      mobilier.add(tabouret);

      // --- Suivi de la souris ------------------------------------------------
      const cible = { x: 0, y: 0 };
      const surSouris = (evenement: PointerEvent) => {
        cible.x = (evenement.clientX / window.innerWidth) * 2 - 1;
        cible.y = (evenement.clientY / window.innerHeight) * 2 - 1;
      };
      window.addEventListener("pointermove", surSouris, { passive: true });

      // --- Redimensionnement -------------------------------------------------
      const redimensionner = () => {
        const largeur = element.clientWidth || 1;
        const hauteur = element.clientHeight || 1;
        renderer.setSize(largeur, hauteur, false);
        camera.aspect = largeur / hauteur;
        camera.updateProjectionMatrix();
      };
      redimensionner();

      const observateur = new ResizeObserver(redimensionner);
      observateur.observe(element);

      const mouvementReduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const dessiner = () => {
        image = window.requestAnimationFrame(dessiner);

        mobilier.rotation.y += (cible.x * 0.42 - mobilier.rotation.y) * 0.045;
        camera.position.x += (cible.x * 0.75 - camera.position.x) * 0.04;
        camera.position.y += (2.15 - cible.y * 0.28 - camera.position.y) * 0.04;
        chaiseDroite.rotation.y +=
          (-Math.PI * 0.44 + cible.x * 0.16 - chaiseDroite.rotation.y) * 0.06;
        camera.lookAt(0, 0.5, 0);

        renderer.render(scene, camera);
      };

      if (mouvementReduit) {
        renderer.render(scene, camera);
      } else {
        dessiner();
      }

      liberer = () => {
        window.removeEventListener("pointermove", surSouris);
        observateur.disconnect();
        scene.traverse((objet) => {
          if (objet instanceof THREE.Mesh) {
            objet.geometry.dispose();
            const materiaux = Array.isArray(objet.material) ? objet.material : [objet.material];
            for (const materiau of materiaux) materiau.dispose();
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      arret = true;
      window.cancelAnimationFrame(image);
      liberer?.();
    };
  }, []);

  return <div ref={conteneur} aria-hidden="true" className="h-full w-full" />;
}
