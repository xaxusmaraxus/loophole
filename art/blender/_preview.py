import bpy, sys, importlib
sys.path.insert(0, REPO + "/tools/blender")
import kit; importlib.reload(kit)
name = [o.name for o in bpy.data.objects if o.type == "MESH"][0]
paths = kit.preview(name)
print(name)
