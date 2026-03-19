'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::game.game', ({ strapi }) => ({
    async updateGameFields(ctx) {
        const { documentId } = ctx.params;
        const { price_per_launch, 
                price_per_month, 
                title, 
                is_published, 
                price_per_day, 
                game_plot,
                game_purpose,
                description,
                about_author,
                game_support,
                format,
                duration,
                author,
                competencies,
                contacts_telegram,
                contacts_whatsapp,
                contacts_email,
                contacts_phone
              } = ctx.request.body;

        const user = ctx.state.user;

        if (!user) {
            return ctx.unauthorized("Authentication required");
        }

        const game = await strapi.db.query('api::game.game').findOne({
            where: { documentId },
            populate: { developed_by: true },
        });

        if (!game) {
            return ctx.notFound("Game not found");
        }

        if (!game.developed_by || game.developed_by.id !== user.id) {
            return ctx.forbidden("You are not allowed to update this game");
        }

        const updatedFields = {};

        if (typeof price_per_launch === 'number') {
            updatedFields.price_per_launch = price_per_launch;
        }

        if (typeof price_per_month === 'number') {
            updatedFields.price_per_month = price_per_month;
        }

        if (typeof price_per_day === 'number') {
            updatedFields.price_per_day = price_per_day;
        }


        if (typeof title === 'string' && title.trim().length > 0) {
            updatedFields.title = title.trim();
        }
        if (typeof is_published === 'boolean') {
            updatedFields.is_published = is_published;

            if (is_published === true) {
                updatedFields.game_published_at = new Date();
            }
        }
        if (
            Array.isArray(game_plot) &&
            game_plot.every(block => typeof block === "object" && block.children)
        ) {
            updatedFields.game_plot = game_plot;
        }
        if (
            Array.isArray(game_purpose) &&
            game_purpose.every(
                   block =>
                   typeof block === 'object' &&
                   Array.isArray(block.children)
                )
              ) {
                updatedFields.game_purpose = game_purpose;
          }
          if (typeof description === 'string') {
            updatedFields.description = description.trim();
          }
      
         if (
            Array.isArray(about_author) &&
            about_author.every(
                   block =>
                   typeof block === 'object' &&
                   Array.isArray(block.children)
                )
              ) {
                updatedFields.about_author = about_author;
          }
      
          if (typeof game_support === 'string') {
            updatedFields.game_support = game_support.trim();
          }
      
          if (typeof format === 'string') {
            updatedFields.format = format.trim();
          }
      
          if (typeof duration === 'string') {
            updatedFields.duration = duration.trim();
          }
          if (typeof author === 'string') {
            updatedFields.author = author.trim();
          }
          if (typeof contacts_telegram === 'string') {
            updatedFields.contacts_telegram = contacts_telegram.trim();
          }
          
          if (typeof contacts_whatsapp === 'string') {
            updatedFields.contacts_whatsapp = contacts_whatsapp.trim();
          }
          
          if (typeof contacts_email === 'string') {
            updatedFields.contacts_email = contacts_email.trim();
          }
          
          if (typeof contacts_phone === 'string') {
            updatedFields.contacts_phone = contacts_phone.trim();
          }
          

          if (Array.isArray(competencies)) {
            const validDocumentIds = competencies
              .filter((id) => typeof id === "string" && id.trim().length > 0);
          
            // Only update competencies if user intends to change them
            if (competencies.length > 0 && validDocumentIds.length === 0) {
              strapi.log.warn('Competencies payload is invalid');
              // Do not update field at all
            } else {
              const matchedCompetencies = await strapi.db.query("api::competency.competency").findMany({
                where: { documentId: { $in: validDocumentIds } },
                select: ["id"],
              });
          
              // Only assign if updating intentionally
              updatedFields.competencies = matchedCompetencies.map((c) => c.id);
            }
          }
          
          
        

        const updatedGame = await strapi.db.query('api::game.game').update({
            where: { id: game.id },
            data: updatedFields,
            populate: { competencies: true },
        });

        return ctx.send({ data: updatedGame });

    },

    async findOneBySlug(ctx) {
      const { slug } = ctx.params;
      const user = ctx.state.user;
    
      const game = await strapi.db.query('api::game.game').findOne({
        where: { slug },
        populate: {
          image: true,
          images: true,
          developed_by: true,
          game_plot: true,
          game_purpose: true,
          competencies: {
            fields: ['id', 'documentId', 'competency_name'],
            populate: true
          },
          faqs: {
            fields: ['id', 'documentId', 'question', 'answer'],
            populate: true,
          }
          
        },
      });
    
      if (!game) return ctx.notFound("Game not found");
    
      if (!game.is_published && game.developed_by?.id !== user?.id) {
        return ctx.unauthorized("You are not allowed to view this game");
      }
    
      return ctx.send({ data: game });
    }
    

}));
