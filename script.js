
document.addEventListener("DOMContentLoaded", function() {
  const cratePrice = 25;

  const collectibles = [
    { name: "Mossy Stone", icon: "🪨", rarity: "Common" },
    { name: "Moonstone", icon: "🌙", rarity: "Uncommon" },
    { name: "Stormglass Gem", icon: "💎", rarity: "Rare" },
    { name: "Phoenix Relic", icon: "🔥", rarity: "Epic" },
    { name: "Dragon Crown", icon: "🐉", rarity: "Legendary" }
  ];

  const coinDisplay = document.getElementById("coins");
  const result = document.getElementById("result");
  const openButton = document.getElementById("openCrate");
  const inventoryDisplay = document.getElementById("inventory");

  // Load saved progress, or start a new game.
  function loadGame() {
    try {
      const savedGame = localStorage.getItem("relicRushSave");

      if (savedGame) {
        const data = JSON.parse(savedGame);

        if (
          Number.isSafeInteger(data.coins) &&
          data.coins >= 0 &&
          data.coins <= 1000000000 &&
          data.inventory &&
          typeof data.inventory === "object" &&
          !Array.isArray(data.inventory)
        ) {
          return {
            coins: data.coins,
            inventory: data.inventory
          };
        }
      }
    } catch (error) {
      console.log("Could not load saved game. Starting fresh.");
    }

    return {
      coins: 100,
      inventory: {}
    };
  }

  const game = loadGame();

  let coins = game.coins;
  const inventory = game.inventory;

  // Save the current coins and inventory.
  function saveGame() {
    try {
      localStorage.setItem(
        "relicRushSave",
        JSON.stringify({
          coins: coins,
          inventory: inventory
        })
      );
    } catch (error) {
      console.error("Could not save your game.", error);
      result.textContent = "Warning: Your progress could not be saved.";
    }
  }

  // Draw the inventory cards.
  function renderInventory() {
    inventoryDisplay.innerHTML = "";

    const items = Object.values(inventory);

    if (items.length === 0) {
      const emptyMessage = document.createElement("p");
      emptyMessage.className = "empty-inventory";
      emptyMessage.textContent = "Your adventure starts here...";
      inventoryDisplay.appendChild(emptyMessage);
      return;
    }

    for (const item of items) {
      const card = document.createElement("div");
      card.className =
        "item-card rarity-" + item.rarity.toLowerCase();

      const icon = document.createElement("div");
      icon.className = "item-icon";
      icon.textContent = item.icon;

      const name = document.createElement("div");
      name.className = "item-name";
      name.textContent = item.name;

      const rarity = document.createElement("div");
      rarity.className = "item-rarity";
      rarity.textContent = item.rarity;

      const count = document.createElement("div");
      count.className = "item-count";
      count.textContent = "Owned: " + item.count;

      card.append(icon, name, rarity, count);
      inventoryDisplay.appendChild(card);
    }
  }

  // Open a crate when the button is clicked.
  openButton.addEventListener("click", function() {
    if (coins < cratePrice) {
      result.textContent = "Not enough coins!";
      return;
    }

    coins -= cratePrice;

    const randomIndex = Math.floor(
      Math.random() * collectibles.length
    );

    const discoveredItem = collectibles[randomIndex];
    const itemName = discoveredItem.name;

    if (inventory[itemName]) {
      inventory[itemName].count++;
    } else {
      inventory[itemName] = {
        ...discoveredItem,
        count: 1
      };
    }

    coinDisplay.textContent = coins;

    result.textContent =
      "You discovered: " +
      discoveredItem.icon + " " +
      discoveredItem.name + "!";

    renderInventory();
    saveGame();
  });

  // Display the loaded game.
  coinDisplay.textContent = coins;
  renderInventory();
});
