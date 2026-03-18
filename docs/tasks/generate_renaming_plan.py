import os
import re
import sys

# Define paths
tasks_dir = r"c:\Work\Tallent\Cubica\docs\tasks"
subdirs = ["content-packs", "epics", "features", "milestones"]
output_file = os.path.join(tasks_dir, "renaming_plan.md")

# Regex to parse filenames: Type-Year-Number-Name.ext
pattern = re.compile(r"^([A-Z]+)-(\d{2})-(\d+)-(.*)(\.[a-z]+)$")

tasks = [] # List of dicts

def scan_files():
    for subdir in subdirs:
        path = os.path.join(tasks_dir, subdir)
        if not os.path.exists(path):
            continue
        for filename in os.listdir(path):
            filepath = os.path.join(path, filename)
            if not os.path.isfile(filepath):
                continue
            
            match = pattern.match(filename)
            if match:
                type_ = match.group(1)
                year = match.group(2)
                num = match.group(3)
                name_part = match.group(4)
                extension = match.group(5)
                
                tasks.append({
                    "filename": filename,
                    "filepath": filepath,
                    "subdir": subdir,
                    "type": type_,
                    "year": year,
                    "num": num,
                    "name_part": name_part,
                    "ext": extension,
                    "old_id": f"{type_}-{year}-{num}"
                })

scan_files()

# Sort tasks to ensure deterministic processing
# Sort by Year (25 first), then Number, then Type
tasks.sort(key=lambda x: (x['year'], x['num'], x['type']))

# Phase 1: Determine New IDs
# Map: Type -> Set of used numbers
used_numbers = {} # type -> set(int)
id_map = {} # old_id -> new_id (e.g. "F_00020" -> "F_00020")

# Pre-populate used numbers with Year 25 tasks (they strictly keep their number)
# Actually, the requirement says "remove year number".
# So F_00020 becomes F_00020.
# F_00025 would collide if mapped to F_00020.
# So we process Year 25 first.

for task in tasks:
    t_type = task['type']
    if t_type not in used_numbers:
        used_numbers[t_type] = set()
    
    if task['year'] == '25':
        num_int = int(task['num'])
        used_numbers[t_type].add(num_int)
        
        # New ID format
        new_id_str = f"{t_type}_{task['num']}" # Keep padding? "00020"
        # task['num'] is string with padding.
        # User example: F_00020. So yes, keep padding/format.
        id_map[task['old_id']] = new_id_str
        task['new_id_short'] = new_id_str
        task['new_num'] = task['num']

# Now process Year 26 (or others), resolving collisions
for task in tasks:
    if task['year'] == '25':
        continue
        
    t_type = task['type']
    old_num_int = int(task['num'])
    
    # Check collision
    # If old_num_int is already in used_numbers[t_type], we must renumber.
    # Note: If F-26-00099 exists and F-25-00099 does NOT exist, can we keep 00099?
    # Yes, unless we want to shift all 26s? The prompt says "renumbering those that have duplication".
    # So if no duplication, keep common number?
    # "Create a list of correspondences... renumbering those of them that have duplication (these are tasks of year -26-)"
    # Implies only renumber on collision.
    
    if old_num_int in used_numbers[t_type]:
        # Collision! Find next free number.
        # Start looking from... maybe 1? or max(used)+1?
        # To avoid fragmentation or future collision, maybe max(used) + 1?
        # Or look for gaps?
        # Let's just increment until we find a free one.
        # We should check against ALL numbers (future ones too)?
        # To be safe, let's collect ALL original numbers in a set first?
        # No, "used_numbers" tracks what we've assigned so far.
        # But we also shouldn't pick a number that belongs to a Year 26 task that hasn't been processed yet 
        # but WOULD have been valid (no collision with 25).
        # E.g. 25 has 10. 26 has 10 (collide -> renum) and 11.
        # If we renum 10->11, we collide with 26's original 11.
        # So we should consider "Numbers taken by Year 25 OR (Year 26 non-collisions)" as restricted?
        pass
        
    # Let's populate a set of "Original numbers used by ANY task of this type"
    # This helps avoid picking a number that is currently used, even if not processed yet.
    # Actually, simplistic approach: find next int not in (Any Original Number of this type).
    
all_original_nums = {}
for task in tasks:
    t = task['type']
    if t not in all_original_nums:
        all_original_nums[t] = set()
    all_original_nums[t].add(int(task['num']))

for task in tasks:
    if task['year'] == '25':
        continue
        
    t_type = task['type']
    original_num_int = int(task['num'])
    
    # Check if this number matches a Year 25 number
    is_collision = False
    
    # Find if there's a 25 task with this number
    for other in tasks:
        if other['year'] == '25' and other['type'] == t_type and int(other['num']) == original_num_int:
            is_collision = True
            break
            
    if is_collision:
        # Renumber
        # Find candidate
        candidate = original_num_int
        while True:
            candidate += 1
            # Check availability:
            # Must not be an original number of any task (to avoid stepping on toes of existing files)
            # AND must not be in used_numbers (to avoid stepping on toes of just-assigned renumberings)
            
            if (candidate not in all_original_nums[t_type]) and (candidate not in used_numbers[t_type]):
                break
        
        new_num_int = candidate
        new_num_str = f"{candidate:05d}"
        used_numbers[t_type].add(new_num_int)
        
        new_id_str = f"{t_type}_{new_num_str}"
        id_map[task['old_id']] = new_id_str
        task['new_id_short'] = new_id_str
        task['new_num'] = new_num_str
        
    else:
        # No collision with Year 25.
        # But wait, what if two Year 26 tasks have same number?
        # e.g. F_00013-a and F_00013-b.
        # The first one processed gets the number. Second one collides?
        # used_numbers should track assignments.
        
        if original_num_int in used_numbers[t_type]:
            # Already taken by a previous 26 task (or 25 task)
            # Logic above handles 25.
            # If taken by previous 26:
            candidate = original_num_int
            while True:
                candidate += 1
                if (candidate not in all_original_nums[t_type]) and (candidate not in used_numbers[t_type]):
                    break
            new_num_int = candidate
            new_num_str = f"{candidate:05d}"
            used_numbers[t_type].add(new_num_int)
            
            new_id_str = f"{t_type}_{new_num_str}"
            id_map[task['old_id']] = new_id_str
            task['new_id_short'] = new_id_str
            task['new_num'] = new_num_str
        else:
            # Free
            used_numbers[t_type].add(original_num_int)
            new_num_str = task['num'] # Keep original padding
            new_id_str = f"{t_type}_{new_num_str}"
            id_map[task['old_id']] = new_id_str
            task['new_id_short'] = new_id_str
            task['new_num'] = new_num_str

# Phase 2: Generate New Filenames
# Also update references inside filenames

# Sort by old_id length descending to avoid partial matches?
# IDs are format X-XX-XXXXX, likely consistent.

files_to_rename = []

with open(output_file, 'w', encoding='utf-8') as f:
    f.write("# Task Renaming Plan\n\n")
    
    f.write("## 1. List of All Task Numbers (Original)\n")
    for t in sorted(tasks, key=lambda x: x['old_id']):
        f.write(f"- {t['old_id']}: {t['filename']}\n")
    
    f.write("\n## 2. Correspondence List (Renaming)\n")
    f.write("| Original File | Old ID | New ID | New File |\n")
    f.write("|---|---|---|---|\n")
    
    for task in tasks:
        # Construct new filename
        # 1. Update IDs in the Name Part
        name_current = task['name_part']
        
        # Regex to find IDs in name: [A-Z]+-\d{2}-\d+
        def replace_id_in_name(match):
            full_id = match.group(0)
            if full_id in id_map:
                return id_map[full_id]
            return full_id # No change if not found?
        
        name_updated_refs = re.sub(r"[A-Z]+-\d{2}-\d+", replace_id_in_name, name_current)
        
        # 2. Replace remaining dashes with underscores
        name_final = name_updated_refs.replace('-', '_')
        
        # 3. Assemble
        # New format: Type_Number_Name.ext
        # task['new_num'] is string
        new_filename = f"{task['type']}_{task['new_num']}_{name_final}{task['ext']}"
        
        f.write(f"| {task['filename']} | {task['old_id']} | {task['new_id_short']} | {new_filename} |\n")
        
        files_to_rename.append({
            "old_path": task['filepath'],
            "new_filename": new_filename,
            "new_path": os.path.join(tasks_dir, task['subdir'], new_filename)
        })

    f.write("\n## 3. Reference Updates\n")
    f.write("All files in the project will be scanned to replace occurrences of old IDs with new IDs.\n")

print(f"Plan generated at {output_file}")
