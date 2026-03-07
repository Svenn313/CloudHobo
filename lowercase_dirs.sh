#!/bin/bash

# Script de normalisation des dossiers et fichiers en minuscules
# Usage: ./lowercase_dirs.sh [--dry-run]
# A exécuter depuis ~/git/CloudHobo

BASE_DIR="$(pwd)"
DRY_RUN=false

if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🔍 Mode dry-run activé (aucune modification ne sera effectuée)"
fi

echo ""
echo "📁 Dossier de travail : $BASE_DIR"
echo ""

rename_item() {
  local old="$1"
  local new="$2"
  if [[ "$old" == "$new" ]]; then return; fi
  if $DRY_RUN; then
    echo "  [dry-run] mv '$(basename $old)' → '$(basename $new)'"
  else
    local tmp="${old}_tmp_rename"
    mv "$old" "$tmp" && mv "$tmp" "$new"
    echo "  ✅ '$(basename $old)' → '$(basename $new)'"
  fi
}

update_file() {
  local file="$1"
  local old="$2"
  local new="$3"
  if grep -q "$old" "$file" 2>/dev/null; then
    if $DRY_RUN; then
      echo "  [dry-run] sed dans $(basename $file) : '$old' → '$new'"
    else
      sed -i "s|$old|$new|g" "$file"
      echo "  ✅ $(basename $file) : '$old' → '$new'"
    fi
  fi
}

# ─────────────────────────────────────────────
# Étape 1 : Renommer les dossiers racines
# ─────────────────────────────────────────────
echo "🔄 Étape 1 : Renommage des dossiers racines..."
echo ""

declare -A dir_renames

for dir in "$BASE_DIR"/*/; do
  dir="${dir%/}"
  dirname=$(basename "$dir")
  lower=$(echo "$dirname" | tr '[:upper:]' '[:lower:]')
  if [[ "$dirname" != "$lower" ]]; then
    dir_renames["$dirname"]="$lower"
    rename_item "$dir" "$BASE_DIR/$lower"
  fi
done

# ─────────────────────────────────────────────
# Étape 2 : Renommer les sous-dossiers Volumes → volumes
# ─────────────────────────────────────────────
echo ""
echo "🔄 Étape 2 : Renommage des sous-dossiers Volumes → volumes..."
echo ""

for volumes_dir in "$BASE_DIR"/*/[Vv]olumes/; do
  volumes_dir="${volumes_dir%/}"
  [[ ! -d "$volumes_dir" ]] && continue
  dirname=$(basename "$volumes_dir")
  lower=$(echo "$dirname" | tr '[:upper:]' '[:lower:]')
  if [[ "$dirname" != "$lower" ]]; then
    rename_item "$volumes_dir" "$(dirname "$volumes_dir")/$lower"
  fi
done

# ─────────────────────────────────────────────
# Étape 3 : Renommer les fichiers yml
# ─────────────────────────────────────────────
echo ""
echo "🔄 Étape 3 : Renommage des fichiers yml..."
echo ""

declare -A yml_renames

while IFS= read -r yml_file; do
  yml_dir=$(dirname "$yml_file")
  yml_name=$(basename "$yml_file")
  lower_name=$(echo "$yml_name" | tr '[:upper:]' '[:lower:]')
  if [[ "$yml_name" != "$lower_name" ]]; then
    yml_renames["$yml_name"]="$lower_name"
    rename_item "$yml_file" "$yml_dir/$lower_name"
  fi
done < <(find "$BASE_DIR" -name "*.yml" -not -path "*/.git/*" 2>/dev/null)

# ─────────────────────────────────────────────
# Étape 4 : Mettre à jour les références ./Volumes dans les yml
# ─────────────────────────────────────────────
echo ""
echo "🔄 Étape 4 : Mise à jour des références ./Volumes dans les yml..."
echo ""

while IFS= read -r yml_file; do
  update_file "$yml_file" "./Volumes/" "./volumes/"
  update_file "$yml_file" "./Volumes" "./volumes"
done < <(find "$BASE_DIR" -name "*.yml" -not -path "*/.git/*" 2>/dev/null)

# ─────────────────────────────────────────────
# Étape 5 : Mettre à jour le docker-compose.yml racine (includes)
# ─────────────────────────────────────────────
echo ""
echo "🔄 Étape 5 : Mise à jour des includes dans docker-compose.yml racine..."
echo ""

ROOT_COMPOSE="$BASE_DIR/docker-compose.yml"

if [[ -f "$ROOT_COMPOSE" ]]; then
  # Renommer les dossiers dans les includes (actifs et commentés)
  for old_name in "${!dir_renames[@]}"; do
    new_name="${dir_renames[$old_name]}"
    update_file "$ROOT_COMPOSE" "- ${old_name}/" "- ${new_name}/"
  done

  # Renommer les fichiers yml dans les includes
  for old_name in "${!yml_renames[@]}"; do
    new_name="${yml_renames[$old_name]}"
    update_file "$ROOT_COMPOSE" "$old_name" "$new_name"
  done
else
  echo "  ⚠️  docker-compose.yml racine non trouvé"
fi

# ─────────────────────────────────────────────
# Étape 6 : Git - re-tracker les fichiers renommés
# ─────────────────────────────────────────────
echo ""
if $DRY_RUN; then
  echo "🔍 [dry-run] git rm -r --cached . && git add . auraient été exécutés"
else
  echo "🔄 Étape 6 : Mise à jour du suivi Git..."
  git -C "$BASE_DIR" rm -r --cached . > /dev/null 2>&1
  git -C "$BASE_DIR" add . > /dev/null 2>&1
  echo "  ✅ Git mis à jour"
fi

echo ""
echo "✅ Terminé !"
if $DRY_RUN; then
  echo "   Lance sans --dry-run pour appliquer les changements."
else
  echo "   N'oublie pas de redémarrer tes conteneurs : docker compose up -d"
fi
