document.addEventListener('DOMContentLoaded', () => {
    const journalContainer = document.getElementById('moves-journal');
    
    const mockupText = "Но на айсберге пингвины были как в<br>крепости, большинство хищников не<br>могли до них добраться, кроме того,<br>айсберг служил надежным убежищем от<br>зимних ледяных штормов благодаря<br>своим размерам и наличию";

    const testMoves = [
        {
            left: mockupText,
            right: mockupText,
            vars: [
                { label: "знания", value: "-1" },
                { label: "доверие", value: "15" },
                { label: "энергия", value: "7", change: "+2" },
                { label: "контроль", value: "-8" },
                { label: "статус", value: "-5" },
                { label: "контакт", value: "10", change: "-2" },
                { label: "конструктив", value: "8" },
                { label: "гибкость", value: "+2" }
            ]
        },
        {
            left: mockupText,
            right: mockupText,
            vars: [
                { label: "знания", value: "-1" },
                { label: "доверие", value: "14" },
                { label: "энергия", value: "9" },
                { label: "контроль", value: "-7" },
                { label: "статус", value: "-5" },
                { label: "контакт", value: "10", change: "+8" },
                { label: "конструктив", value: "9" },
                { label: "гибкость", value: "+2" }
            ]
        }
    ];

    for (let i = 3; i <= 10; i++) {
        testMoves.push({
            left: `Ход игры №${i}: Исследование арктических просторов продолжается. Группа ученых обнаружила новые следы древней цивилизации подо льдом.`,
            right: `Результат №${i}: Удалось собрать важные образцы, но запасы провизии на исходе. Доверие в команде падает.`,
            vars: [
                { label: "знания", value: "+" + (5 + i) },
                { label: "доверие", value: 10 - i },
                { label: "энергия", value: 20 - i*2, change: "-2" },
                { label: "контроль", value: i },
                { label: "статус", value: 3 },
                { label: "контакт", value: 5, change: "+1" },
                { label: "конструктив", value: 12 },
                { label: "гибкость", value: "+5" }
            ]
        });
    }

    testMoves.forEach(move => {
        const moveEl = document.createElement('div');
        moveEl.className = 'move-item';
        
        const cardsEl = document.createElement('div');
        cardsEl.className = 'move-cards';
        
        const cardLeft = document.createElement('div');
        cardLeft.className = 'card-left';
        cardLeft.innerHTML = move.left;
        
        const cardRight = document.createElement('div');
        cardRight.className = 'card-right';
        cardRight.innerHTML = move.right;
        
        cardsEl.appendChild(cardLeft);
        cardsEl.appendChild(cardRight);
        
        const varsRow = document.createElement('div');
        varsRow.className = 'variables-row';
        
        move.vars.forEach(v => {
            const vItem = document.createElement('div');
            vItem.className = 'variable-item';
            
            const vVal = document.createElement('div');
            vVal.className = 'variable-value';
            vVal.innerHTML = `${v.value}${v.change ? `<span class="value-change">${v.change}</span>` : ''}`;
            
            const vLab = document.createElement('div');
            vLab.className = 'variable-label';
            vLab.textContent = v.label;
            
            vItem.appendChild(vVal);
            vItem.appendChild(vLab);
            varsRow.appendChild(vItem);
        });
        
        moveEl.appendChild(cardsEl);
        moveEl.appendChild(varsRow);
        journalContainer.appendChild(moveEl);
    });

    document.getElementById('btn-journal').onclick = () => alert('Журнал ходов');
    document.getElementById('btn-hint').onclick = () => alert('Подсказка');
    document.getElementById('btn-prev').onclick = () => {
        journalContainer.scrollBy({ top: -450, behavior: 'smooth' });
    };
    document.getElementById('btn-next').onclick = () => {
        journalContainer.scrollBy({ top: 450, behavior: 'smooth' });
    };
});
