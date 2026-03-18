/**
 * Inventory Management Scripts for Cubica RPG Demo
 *
 * This file demonstrates the script handler pattern from ADR-007 (Hybrid Execution Model).
 * Scripts execute in a sandboxed environment with access to:
 * - state: Current game state (public and secret)
 * - args: Arguments passed from the action
 * - std: Standard library provided by the engine (ui, inventory helpers, etc.)
 *
 * Scripts can modify state directly - the engine applies changes atomically.
 * Scripts have a timeout limit (default: 100ms) to prevent infinite loops.
 */

// ============================================================================
// INVENTORY OPERATIONS
// ============================================================================

/**
 * Add an item to the player's inventory.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.itemId - Unique identifier of the item to add
 * @param {number} [args.quantity=1] - Amount to add
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Result object with success status and message
 */
export function addItem(state, args, std) {
  const { itemId, quantity = 1 } = args;
  const inventory = state.public.inventory;
  const maxSlots = state.public.inventory.max_slots;

  // Validate item exists in game definitions
  const itemDef = std.items.get(itemId);
  if (!itemDef) {
    std.ui.error(`Unknown item: ${itemId}`);
    return { success: false, error: 'ITEM_NOT_FOUND' };
  }

  // Find existing stack or empty slot
  if (itemDef.stackable) {
    // Try to add to existing stack
    const existingSlot = inventory.slots.find(
      slot => slot.itemId === itemId && slot.quantity < itemDef.max_stack
    );

    if (existingSlot) {
      const spaceInStack = itemDef.max_stack - existingSlot.quantity;
      const toAdd = Math.min(quantity, spaceInStack);
      existingSlot.quantity += toAdd;

      if (toAdd < quantity) {
        // Recursively add remaining items to new slot
        return addItem(state, { itemId, quantity: quantity - toAdd }, std);
      }

      std.ui.toast(`Added ${quantity}x ${itemDef.name}`);
      return { success: true, added: quantity };
    }
  }

  // Need a new slot
  if (inventory.slots.length >= maxSlots) {
    std.ui.error('Inventory is full!');
    return { success: false, error: 'INVENTORY_FULL' };
  }

  // Create new slot
  inventory.slots.push({
    itemId: itemId,
    quantity: itemDef.stackable ? quantity : 1
  });

  std.ui.toast(`Added ${itemDef.stackable ? quantity + 'x ' : ''}${itemDef.name}`);
  return { success: true, added: itemDef.stackable ? quantity : 1 };
}

/**
 * Remove an item from the player's inventory.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.itemId - Unique identifier of the item to remove
 * @param {number} [args.quantity=1] - Amount to remove
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Result object with success status
 */
export function removeItem(state, args, std) {
  const { itemId, quantity = 1 } = args;
  const inventory = state.public.inventory;

  // Find the item in inventory
  const slotIndex = inventory.slots.findIndex(slot => slot.itemId === itemId);

  if (slotIndex === -1) {
    std.ui.error('Item not in inventory');
    return { success: false, error: 'ITEM_NOT_IN_INVENTORY' };
  }

  const slot = inventory.slots[slotIndex];

  if (slot.quantity < quantity) {
    std.ui.error(`Not enough items (have ${slot.quantity}, need ${quantity})`);
    return { success: false, error: 'INSUFFICIENT_QUANTITY' };
  }

  slot.quantity -= quantity;

  // Remove empty slots
  if (slot.quantity <= 0) {
    inventory.slots.splice(slotIndex, 1);
  }

  const itemDef = std.items.get(itemId);
  std.ui.toast(`Removed ${quantity}x ${itemDef?.name || itemId}`);

  return { success: true, removed: quantity };
}

/**
 * Use a consumable item.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.itemId - Unique identifier of the item to use
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Result object with effect details
 */
export function useItem(state, args, std) {
  const { itemId } = args;

  // Validate item exists in inventory
  const slot = state.public.inventory.slots.find(s => s.itemId === itemId);
  if (!slot) {
    std.ui.error('Item not in inventory');
    return { success: false, error: 'ITEM_NOT_IN_INVENTORY' };
  }

  const itemDef = std.items.get(itemId);
  if (!itemDef) {
    std.ui.error('Unknown item');
    return { success: false, error: 'ITEM_NOT_FOUND' };
  }

  if (itemDef.type !== 'consumable') {
    std.ui.error('This item cannot be used');
    return { success: false, error: 'NOT_CONSUMABLE' };
  }

  // Apply effects
  const effects = itemDef.effects || {};
  const player = state.public.player;
  const appliedEffects = [];

  if (effects.heal) {
    const actualHeal = Math.min(effects.heal, player.max_hp - player.hp);
    player.hp += actualHeal;
    appliedEffects.push(`Healed ${actualHeal} HP`);
  }

  if (effects.mana) {
    // Example of potential mana system
    if (player.mana !== undefined) {
      const actualMana = Math.min(effects.mana, player.max_mana - player.mana);
      player.mana += actualMana;
      appliedEffects.push(`Restored ${actualMana} Mana`);
    }
  }

  // Remove used item
  removeItem(state, { itemId, quantity: 1 }, std);

  std.ui.toast(`Used ${itemDef.name}: ${appliedEffects.join(', ')}`);

  return {
    success: true,
    effects: appliedEffects,
    item: itemDef.name
  };
}

// ============================================================================
// EQUIPMENT OPERATIONS
// ============================================================================

/**
 * Equip an item to the appropriate slot.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.itemId - Unique identifier of the item to equip
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Result object with equipment details
 */
export function equipItem(state, args, std) {
  const { itemId } = args;
  const inventory = state.public.inventory;
  const equipment = state.public.equipment;

  // Check item is in inventory
  const slotIndex = inventory.slots.findIndex(s => s.itemId === itemId);
  if (slotIndex === -1) {
    std.ui.error('Item not in inventory');
    return { success: false, error: 'ITEM_NOT_IN_INVENTORY' };
  }

  const itemDef = std.items.get(itemId);
  if (!itemDef) {
    std.ui.error('Unknown item');
    return { success: false, error: 'ITEM_NOT_FOUND' };
  }

  // Determine equipment slot
  let slot;
  switch (itemDef.type) {
    case 'weapon':
      slot = 'weapon';
      break;
    case 'armor':
      slot = 'armor';
      break;
    case 'accessory':
      slot = 'accessory';
      break;
    default:
      std.ui.error('This item cannot be equipped');
      return { success: false, error: 'NOT_EQUIPPABLE' };
  }

  // Unequip current item if any
  const currentEquipped = equipment[slot];
  if (currentEquipped) {
    // Return current item to inventory
    addItem(state, { itemId: currentEquipped, quantity: 1 }, std);
  }

  // Remove new item from inventory and equip
  inventory.slots.splice(slotIndex, 1);
  equipment[slot] = itemId;

  std.ui.toast(`Equipped ${itemDef.name}`);

  return {
    success: true,
    slot: slot,
    item: itemDef.name,
    previousItem: currentEquipped
  };
}

/**
 * Unequip an item from a slot.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.slot - Equipment slot ('weapon', 'armor', 'accessory')
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Result object
 */
export function unequipItem(state, args, std) {
  const { slot } = args;
  const equipment = state.public.equipment;

  if (!['weapon', 'armor', 'accessory'].includes(slot)) {
    std.ui.error('Invalid equipment slot');
    return { success: false, error: 'INVALID_SLOT' };
  }

  const equippedItemId = equipment[slot];
  if (!equippedItemId) {
    std.ui.error('Nothing equipped in that slot');
    return { success: false, error: 'SLOT_EMPTY' };
  }

  // Add item back to inventory
  const result = addItem(state, { itemId: equippedItemId, quantity: 1 }, std);
  if (!result.success) {
    return result; // Inventory full, etc.
  }

  equipment[slot] = null;

  const itemDef = std.items.get(equippedItemId);
  std.ui.toast(`Unequipped ${itemDef?.name || equippedItemId}`);

  return { success: true, unequipped: equippedItemId };
}

// ============================================================================
// TRADING OPERATIONS
// ============================================================================

/**
 * Buy an item from the shop.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.itemId - Unique identifier of the item to buy
 * @param {number} [args.quantity=1] - Amount to buy
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Result object with transaction details
 */
export function buyItem(state, args, std) {
  const { itemId, quantity = 1 } = args;
  const player = state.public.player;
  const shopInventory = state.secret.shop_inventory;

  // Find item in shop
  const shopItem = shopInventory.find(item => item.id === itemId);
  if (!shopItem) {
    std.ui.error('Item not available in shop');
    return { success: false, error: 'ITEM_NOT_IN_SHOP' };
  }

  if (shopItem.stock < quantity) {
    std.ui.error(`Only ${shopItem.stock} available`);
    return { success: false, error: 'INSUFFICIENT_STOCK' };
  }

  const totalCost = shopItem.price * quantity;
  if (player.gold < totalCost) {
    std.ui.error(`Not enough gold (need ${totalCost}, have ${player.gold})`);
    return { success: false, error: 'INSUFFICIENT_GOLD' };
  }

  // Process transaction
  player.gold -= totalCost;
  shopItem.stock -= quantity;

  const addResult = addItem(state, { itemId, quantity }, std);
  if (!addResult.success) {
    // Rollback transaction
    player.gold += totalCost;
    shopItem.stock += quantity;
    return addResult;
  }

  std.ui.toast(`Bought ${quantity}x ${shopItem.name} for ${totalCost} gold`);

  return {
    success: true,
    item: shopItem.name,
    quantity: quantity,
    cost: totalCost,
    remaining_gold: player.gold
  };
}

/**
 * Sell an item to the shop.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.itemId - Unique identifier of the item to sell
 * @param {number} [args.quantity=1] - Amount to sell
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Result object with transaction details
 */
export function sellItem(state, args, std) {
  const { itemId, quantity = 1 } = args;
  const player = state.public.player;

  const itemDef = std.items.get(itemId);
  if (!itemDef) {
    std.ui.error('Unknown item');
    return { success: false, error: 'ITEM_NOT_FOUND' };
  }

  if (!itemDef.base_price || itemDef.base_price === 0) {
    std.ui.error('This item cannot be sold');
    return { success: false, error: 'NOT_SELLABLE' };
  }

  // Sell price is typically 50% of base price
  const sellPrice = Math.floor(itemDef.base_price * 0.5) * quantity;

  // Remove from inventory
  const removeResult = removeItem(state, { itemId, quantity }, std);
  if (!removeResult.success) {
    return removeResult;
  }

  // Add gold
  player.gold += sellPrice;

  std.ui.toast(`Sold ${quantity}x ${itemDef.name} for ${sellPrice} gold`);

  return {
    success: true,
    item: itemDef.name,
    quantity: quantity,
    earned: sellPrice,
    total_gold: player.gold
  };
}

// ============================================================================
// COMBAT OPERATIONS
// ============================================================================

/**
 * Calculate attack damage based on player stats and equipment.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.targetId - Target creature identifier
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Attack result with damage and effects
 */
export function calculateAttack(state, args, std) {
  const { targetId } = args;
  const player = state.public.player;
  const equipment = state.public.equipment;

  // Base attack power
  let attackPower = 5 + player.level;

  // Add weapon bonus
  if (equipment.weapon) {
    const weaponDef = std.items.get(equipment.weapon);
    if (weaponDef?.stats?.attack) {
      attackPower += weaponDef.stats.attack;
    }
  }

  // Add some randomness (80-120% of base)
  const variance = 0.8 + (Math.random() * 0.4);
  const finalDamage = Math.floor(attackPower * variance);

  // Critical hit chance (10%)
  const isCritical = Math.random() < 0.1;
  const damage = isCritical ? finalDamage * 2 : finalDamage;

  std.ui.toast(isCritical
    ? `Critical hit! Dealt ${damage} damage!`
    : `Dealt ${damage} damage`
  );

  return {
    success: true,
    target: targetId,
    damage: damage,
    critical: isCritical,
    base_attack: attackPower
  };
}

/**
 * Generate loot from a defeated enemy or container.
 *
 * @param {Object} state - Current game state
 * @param {Object} args - Action arguments
 * @param {string} args.sourceType - Type of loot source ('enemy', 'chest', 'corpse')
 * @param {string} args.sourceId - Identifier of the loot source
 * @param {Object} std - Standard library provided by engine
 * @returns {Object} Generated loot items
 */
export function generateLoot(state, args, std) {
  const { sourceType, sourceId } = args;
  const lootTables = state.secret.loot_tables;

  // Get loot table for this source
  const lootTable = lootTables[sourceId] || lootTables[sourceType] || [];

  if (lootTable.length === 0) {
    std.ui.toast('No loot found');
    return { success: true, loot: [] };
  }

  // Randomly select 1-3 items
  const numItems = 1 + Math.floor(Math.random() * 3);
  const generatedLoot = [];

  for (let i = 0; i < numItems; i++) {
    const randomIndex = Math.floor(Math.random() * lootTable.length);
    const itemId = lootTable[randomIndex];

    // Handle gold specially
    if (itemId === 'gold_coins') {
      const goldAmount = 5 + Math.floor(Math.random() * 20);
      state.public.player.gold += goldAmount;
      generatedLoot.push({ item: 'Gold', quantity: goldAmount });
    } else {
      const addResult = addItem(state, { itemId, quantity: 1 }, std);
      if (addResult.success) {
        const itemDef = std.items.get(itemId);
        generatedLoot.push({ item: itemDef?.name || itemId, quantity: 1 });
      }
    }
  }

  std.ui.toast(`Found: ${generatedLoot.map(l => `${l.quantity}x ${l.item}`).join(', ')}`);

  return {
    success: true,
    loot: generatedLoot,
    source: sourceId
  };
}
