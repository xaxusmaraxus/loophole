# Preview all tiles side by side: import the GLBs into an empty scene and render once.
import bpy, sys, importlib, os, math
sys.path.insert(0, REPO + "/tools/blender")
import kit; importlib.reload(kit)
kit.reset()
for t in range(1, 8):
    bpy.ops.import_scene.gltf(filepath=os.path.join(kit.MODELS, "tile_%d.glb" % t))
    for ob in bpy.context.selected_objects:
        ob.location.x += (t - 4) * 1.0
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_cavity = True
scene.render.resolution_x, scene.render.resolution_y = 1400, 360
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c"))
cam.data.type = "ORTHO"; cam.data.ortho_scale = 7.4
scene.collection.objects.link(cam); scene.camera = cam
cam.location = (0, -6, 5); cam.rotation_euler = (math.radians(50), 0, 0)
scene.render.filepath = os.path.join(REPO, "art", "previews", "tiles.png")
bpy.ops.render.render(write_still=True)
